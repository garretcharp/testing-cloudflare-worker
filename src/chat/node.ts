import { Hono } from 'hono'

export default class ChatNode implements DurableObject {
	private app = new Hono<Bindings>()

	private sockets = new Map<string, WebSocket>()

	private manager: WebSocket | undefined

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.use('*', async (_, next) => {
			const deleted = await this.state.storage.get('deleted')
			if (deleted) return new Response('This node no longer exists', { status: 410 })

			await next()
		})

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

		this.app.get('/internal/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket')
				return new Response('Expected Upgrade: websocket', { status: 426 })

			const requestId = c.req.header('cf-ray')
			if (typeof requestId !== 'string') return new Response('Internal error', { status: 500 })

			const managerId = (c.req.cf as any)?.managerId as string
			if (typeof managerId !== 'string') return new Response('Internal error', { status: 500 })

			const { 0: client, 1: connection } = new WebSocketPair()
			this.manager = connection

			connection.accept()

			connection.addEventListener('message', async (message) => {
				if (typeof message.data !== 'string') return

				const data = JSON.parse(message.data)

				if (data.type === 'GetChatters')
					return connection.send(
						JSON.stringify({
							type: 'ReportChatters',
							chatters: Array.from(this.sockets.keys())
						})
					)

				if (data.type === 'DeleteSocket') {
					this.state.storage.put('deleted', true)
					await this.state.storage.setAlarm(Date.now() + 5000)

					setTimeout(() => {
						if (this.manager && this.manager.readyState === 1) {
							try {
								this.manager.close()
							} catch (error) {}
						}

						for (const socket of this.sockets.values()) {
							if (socket.readyState === 1) {
								try {
									socket.close()
								} catch (error) {}
							}
						}
					}, 1000)

					return connection.send(
						JSON.stringify({ type: 'DeletedNode' })
					)
				}
			})

			connection.addEventListener('close', async () => {
				try {
					this.manager = undefined

					await c.env.ChatManager.get(
						c.env.ChatManager.idFromString(managerId)
					).fetch('https://fake-host/internal/keep-alive')
				} catch (error) {
					// ignore error for now
				}
			})

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
		await this.state.storage.deleteAll()

		if (this.manager && this.manager.readyState === 1) {
			try {
				this.manager.close()
			} catch (error) {}
		}

		for (const socket of this.sockets.values()) {
			if (socket.readyState === 1) {
				try {
					socket.close()
				} catch (error) {}
			}
		}

		this.manager = undefined
		this.sockets.clear()
	}
}
