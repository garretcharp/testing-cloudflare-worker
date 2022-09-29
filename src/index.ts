import { Hono } from 'hono'
import ChatManager from './chat/manager'
import ChatNode from './chat/node'

const app = new Hono<Bindings>()

app.get('/', async c => {
	return c.text('Hello :) this is just a test')
})

app.get('/cache/force-hit', async c => {
	try {
		await caches.default.put(c.req, c.json({ success: true, cached: true }))
		const match = await caches.default.match(c.req)
		return match ?? c.json({ success: true, cached: false })
	} catch (error: any) {
		return c.json({ success: false, error: error.message }, 500)
	}
})

app.get('/cache/force-miss', async c => {
	try {
		const match = await caches.default.match(c.req)
		return match ?? c.json({ success: true, cached: false })
	} catch (error: any) {
		return c.json({ success: false, error: error.message }, 500)
	}
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
		return c.env.ChatManager.get(
			c.env.ChatManager.idFromName('my-chat-manager')
		).fetch('https://my-chat-manager/websocket', c.req)
	} catch (error: any) {
		return c.json({ error: error.message }, 500)
	}
})

app.get('/do/websocket/nodes', async c => {
	try {
		return c.env.ChatManager.get(
			c.env.ChatManager.idFromName('my-chat-manager')
		).fetch('https://my-chat-manager/nodes', c.req)
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
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}
}

export { ChatManager, ChatNode }
