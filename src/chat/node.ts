import { Hono } from 'hono'

export default class ChatNode implements DurableObject {
	private app = new Hono<Bindings>()

	private sockets = new Map<string, WebSocket>()

	private manager: WebSocket | undefined

	private deleted = false
	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.use('*', async (_, next) => {
			if (this.deleted) return new Response('This node no longer exists', { status: 410 })

			const action = await this.state.storage.get<string>('action', { allowConcurrency: true })
			if (action === 'delete') {
				this.deleted = true
				return new Response('This node no longer exists', { status: 410 })
			}

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
					this.deleted = true
					this.state.storage.put('action', 'delete', { allowConcurrency: true })
					await this.state.storage.setAlarm(Date.now() + 1000 * 60)

					setTimeout(() => {
						if (this.manager) {
							try {
								this.manager.close()
							} catch (error) {}
						}

						for (const socket of this.sockets.values()) {
							try {
								socket.close()
							} catch (error) {}
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

					const response = await c.env.ChatManager.get(
						c.env.ChatManager.idFromString(managerId)
					).fetch(`https://fake-host/internal/keep-alive?id=${this.state.id.toString()}`)

					if (response.status !== 200) {
						const action = await this.state.storage.get<string>('action', { allowConcurrency: true })
						if (action) return
						this.state.storage.put({
							action: 'keep-alive',
							managerId,
							attempt: 1
						}, { allowConcurrency: true })
						await this.state.storage.setAlarm(Date.now() + 1000)
					}
				} catch (error) {
					const action = await this.state.storage.get<string>('action', { allowConcurrency: true })
					if (action) return
					this.state.storage.put({
						action: 'keep-alive',
						managerId,
						attempt: 1
					}, { allowConcurrency: true })
					await this.state.storage.setAlarm(Date.now() + 1000)
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
		const values = await this.state.storage.get<string | number>(['action', 'managerId', 'attempt'], { allowConcurrency: true })

		if (values.get('action') === 'keep-alive') {
			if (this.manager) return

			if (!values.has('managerId')) {
				return this.state.storage.put('action', 'delete', { allowConcurrency: true })
			}

			const managerId = values.get('managerId') as string
			const attempt = (values.get('attempt') as number) ?? 1

			try {
				const response = await this.env.ChatManager.get(
					this.env.ChatManager.idFromString(managerId)
				).fetch(`https://fake-host/internal/keep-alive?id=${this.state.id.toString()}`)

				if (response.status !== 200 && attempt < 10) {
					this.state.storage.put({
						action: 'keep-alive',
						managerId,
						attempt: attempt + 1
					}, { allowConcurrency: true })

					await this.state.storage.setAlarm(Date.now() + 1000)
				}

				const data = await response.json<{ valid: boolean }>()

				if (!data.valid) await this.state.storage.put('action', 'delete', { allowConcurrency: true })
			} catch (error) {
				if (attempt < 10) {
					this.state.storage.put({
						action: 'keep-alive',
						managerId,
						attempt: attempt + 1
					}, { allowConcurrency: true })

					await this.state.storage.setAlarm(Date.now() + 1000)
				} else {
					await this.state.storage.put('action', 'delete', { allowConcurrency: true })
				}
			}
		}

		if (values.get('action') === 'delete') {
			this.deleted = true
			await this.state.storage.deleteAll()

			if (this.manager) {
				try {
					this.manager.close()
				} catch (error) {}
			}

			for (const socket of this.sockets.values()) {
				try {
					socket.close()
				} catch (error) {}
			}

			this.manager = undefined
			this.sockets.clear()
		}
	}
}
