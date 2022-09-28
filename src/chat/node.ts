import { Hono } from 'hono'

export default class ChatNode implements DurableObject {
	private app = new Hono<Bindings>()

	private sockets = new Map<string, WebSocket>()

	private manager: string | undefined

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.get('/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket')
				return new Response('Expected Upgrade: websocket', { status: 426 })

			const requestId = c.req.header('cf-ray') ?? 'idk'
			if (!requestId) return new Response('Expected cf-ray header', { status: 400 })

			this.manager = new URL(c.req.url).hostname

			const { 0: client, 1: connection } = new WebSocketPair()

			connection.accept()
			this.sockets.set(requestId, connection)
			this.state.storage.setAlarm(Date.now())

			connection.send(
				JSON.stringify({
					message: 'Hello!',
					node: this.state.id.toString(),
					manager: this.manager
				})
			)

			connection.addEventListener('message', async (message) => {
				if (typeof message.data === 'string') {
					const [cmd, ...data] = message.data.split(' ')

					connection.send(
						JSON.stringify({
							command: cmd.replace('/', ''),
							data: data.join(' ')
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
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}

	async alarm() {
		if (!this.manager) return

		await this.env.ChatManager.get(
			this.env.ChatManager.idFromName(this.manager)
		).fetch('https://fake-host/internal/node/data', {
			method: 'POST',
			body: JSON.stringify({
				id: this.state.id.toString(),
				type: 'ReportChatters',
				chatters: Array.from(this.sockets.keys())
			})
		})
	}
}
