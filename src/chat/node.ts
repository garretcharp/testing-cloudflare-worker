import { Hono } from 'hono'

export default class ChatNode implements DurableObject {
	private app = new Hono<Bindings>()

	private sockets = new Map<string, WebSocket>()

	private manager: WebSocket | undefined

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.get('/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket')
				return new Response('Expected Upgrade: websocket', { status: 426 })

			const requestId = c.req.header('cf-ray') ?? 'idk'
			if (!requestId) return new Response('Expected cf-ray header', { status: 400 })

			const { 0: client, 1: connection } = new WebSocketPair()

			connection.accept()
			this.sockets.set(requestId, connection)

			try {
				this.manager?.send(JSON.stringify({ type: 'ReportChatters', chatters: [...this.sockets.keys()] }))
			} catch (error) {
				// TODO: Handle error?
			}

			connection.send(
				JSON.stringify({
					message: 'Hello!',
					node: this.state.id.toString(),
					managerState: this.manager?.readyState
				})
			)

			connection.addEventListener('message', async (message) => {
				if (typeof message.data === 'string') {
					const [cmd, ...data] = message.data.split(' ')

					connection.send(
						JSON.stringify({
							command: cmd.replace('/', ''),
							data: data.join(' '),
							chatters: Array.from(this.sockets.keys())
						})
					)
				} else {
					connection.send(
						JSON.stringify({
							error: 'Send message as a string'
						})
					)
				}
			})

			connection.addEventListener('close', () => this.sockets.delete(requestId))

			return new Response(null, {
				status: 101,
				webSocket: client
			})
		})

		this.app.get('/chatters', async c => {
			return c.json(Array.from(this.sockets.keys()))
		})

		this.app.get('/internal/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket')
				return new Response('Expected Upgrade: websocket', { status: 426 })

			const requestId = c.req.header('cf-ray') ?? 'idk'
			if (!requestId) return new Response('Expected cf-ray header', { status: 400 })

			const { 0: client, 1: connection } = new WebSocketPair()

			connection.accept()
			this.manager = connection

			connection.addEventListener('message', async (message) => {
				if (typeof message.data !== 'string') return

				const data = JSON.parse(message.data)

				if (data.type === 'GetChatters')
					connection.send(
						JSON.stringify({
							type: 'ReportChatters',
							chatters: Array.from(this.sockets.keys())
						})
					)
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
