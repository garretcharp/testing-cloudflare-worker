import { Hono } from 'hono'

const app = new Hono<Bindings>()

app.get('/', async c => {
	return c.text('Hello :) this is just a test')
})

app.get('/d1/insert', async c => {
	const statement = c.env.TestD1.prepare('INSERT INTO Test (name) VALUES (?) RETURNING *')

	const result = await statement.bind(c.req.query('name') ?? 'My cool test item').first()

	return c.json(result)
})

app.get('/d1/select', async c => {
	const statement = c.env.TestD1.prepare('SELECT * FROM Test')

	const result = await statement.all()

	return c.json(result)
})

app.get('/do/d1', async c => {
	try {
		return c.env.TestDO.get(
			c.env.TestDO.idFromName('1')
		).fetch('https://fake-host/d1-in-do')
	} catch (error: any) {
		return c.json({ error: error.message }, 500)
	}
})

app.get('/do/websocket', async c => {
	try {
		return c.env.TestDO.get(
			c.env.TestDO.idFromName('1')
		).fetch('https://fake-host/websocket', {
			headers: c.req.headers
		})
	} catch (error: any) {
		return c.json({ error: error.message }, 500)
	}
})

app.get('/r2/public/cors', async c => {
	return c.html(`
		<html>
			<head>
				<title>Test</title>
			</head>
			<body>
				<h1>Test</h1>
				<img src="https://cdn.garretcharp.com/p9PZMKacGOxcibD.png" />
			</body>
		</html>
	`)
})

export default {
	fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
		return app.fetch(request, env, ctx)
	}
}

export class TestDO implements DurableObject {
	private app = new Hono<Bindings>()

	private sockets = new Map<string, WebSocket>()

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.get('/d1-in-do', async c => {
			try {
				const statement = c.env.TestD1.prepare('SELECT * FROM Test')

				const result = await statement.all()

				return c.json(result)
			} catch (error: any) {
				return c.json({ error: error.message }, 500)
			}
		})

		this.app.get('/websocket', async c => {
			const upgrade = c.req.header('upgrade')

			if (upgrade !== 'websocket')
				return new Response('Expected Upgrade: websocket', { status: 426 })

			const { 0: client, 1: connection } = new WebSocketPair()

			const requestId = c.req.header('cf-ray') ?? 'idk'

			connection.accept()
			this.sockets.set(requestId, connection)

			connection.addEventListener('message', async (message) => {
				if (typeof message.data === 'string') {
					const [cmd, ...data] = message.data.split(' ')

					switch (cmd) {
						case '/list':
							const messages = await this.state.storage.list({
								prefix: 'Message/',
								reverse: true,
								limit: 100,
								allowConcurrency: true,
								noCache: true
							})
							connection.send(JSON.stringify(Array.from(messages.values())))
							break
						case '/send':
							const id = crypto.randomUUID(), createdAt = new Date().toISOString()

							await this.state.storage.put(`Message/${createdAt}/${id}`, {
								id,
								createdAt,
								message: data.join(' '),
								sender: requestId
							}, {
								allowConcurrency: true,
								noCache: true
							})

							for (const socket of this.sockets.values()) {
								socket.send(`[${requestId}]: ${data.join(' ')}`)
							}

							break
						case '/connections':
							connection.send('Connections: ' + this.sockets.size)
							break
						default:
							connection.send('Invalid command. Must be one of [/list, /send]')
							break
					}
				} else {
					connection.send('Error: send messages as strings')
				}
			})

			connection.addEventListener('close', () => this.sockets.delete(requestId))

			return new Response(null, {
				status: 101,
				webSocket: client
			})
		})
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}
}
