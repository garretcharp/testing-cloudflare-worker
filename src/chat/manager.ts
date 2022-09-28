import { Hono } from 'hono'

type ReportChatters = {
	type: 'ReportChatters'
	chatters: string[]
}

type SendMessage = {
	type: 'SendMessage'
	message: string
	sender: string
}

export type NodeMessage = ReportChatters | SendMessage

export default class ChatManager implements DurableObject {
	private app = new Hono<Bindings>()

	private nodes = new Map<string, { socket: WebSocket | undefined, chatters: string[] }>()

	private async findChatNode() {
		for (const [id, { chatters }] of this.nodes.entries()) {
			if (chatters.length < 500) return this.env.ChatNode.get(this.env.ChatNode.idFromString(id))
		}

		const id = this.env.ChatNode.newUniqueId()
		this.state.storage.put(`ChatNodes/${id.toString()}`, '')
		await this.connectWebsocket(id)

		return this.env.ChatNode.get(id)
	}

	private async connectWebsocket(id: DurableObjectId) {
		if (!this.nodes.has(id.toString())) return

		this.nodes.set(id.toString(), {
			socket: undefined,
			chatters: this.nodes.get(id.toString())?.chatters ?? []
		})

		try {
			const node = this.env.ChatNode.get(id)

			const { webSocket } = await node.fetch('https://fake-host/internal/websocket', {
				headers: {
					'upgrade': 'websocket'
				}
			})

			if (!webSocket) {
				setTimeout(() => this.connectWebsocket(id), 1000)

				return
			}

			this.nodes.set(id.toString(), {
				socket: webSocket,
				chatters: this.nodes.get(id.toString())?.chatters ?? []
			})

			webSocket.accept()

			webSocket.send(JSON.stringify({ type: 'GetChatters' }))

			webSocket.addEventListener('message', (message) => {
				if (typeof message.data !== 'string') return

				const data = JSON.parse(message.data) as NodeMessage

				if (data.type === 'ReportChatters')
					this.nodes.set(id.toString(), {
						socket: webSocket,
						chatters: data.chatters
					})
			})

			webSocket.addEventListener('error', () => {
				// TODO: Handle error
			})

			webSocket.addEventListener('close', () => {
				setTimeout(() => this.connectWebsocket(id), 1000)
			})
		} catch (error) {
			setTimeout(() => this.connectWebsocket(id), 1000)
		}
	}

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.state.blockConcurrencyWhile(async () => {
			const nodes = await state.storage.list({ prefix: 'ChatNodes/' })

			await Promise.all(
				[...nodes.keys()].map(key => {
					const id = key.replace('ChatNodes/', '')

					this.nodes.set(id, { socket: undefined, chatters: [] })
					return this.connectWebsocket(this.env.ChatNode.idFromString(id))
				})
			)

			await this.state.storage.setAlarm(Date.now() + 1000 * 10)
		})

		this.app.get('/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 })

			return (await this.findChatNode()).fetch(`https://${this.state.id.toString()}/websocket`, {
				headers: c.req.headers,
				cf: {
					// @ts-ignore
					managerId: this.state.id.toString()
				}
			})
		})

		this.app.get('/nodes', async c => {
			return c.json(Object.fromEntries(this.nodes.entries()))
		})

		this.app.get('/internal/keep-alive', async c => c.json({ ok: true }))

		// this.app.post('/internal/node/data', async c => {
		// 	const data = await c.req.json<NodeMessage>()

		// 	switch(data.type) {
		// 		case 'ReportChatters':
		// 			this.nodes.set(data.id, { chatters: data.chatters })
		// 			return c.json({ ok: true })
		// 		case 'SendMessage':
		// 			const createdAt = new Date().toISOString(), id = crypto.randomUUID()
		// 			await this.state.storage.put(`Messages/${createdAt}/${id}`, {
		// 				id,
		// 				createdAt,
		// 				sender: data.sender,
		// 				message: data.message
		// 			})
		// 			for (const node of this.nodes.keys()) {
		// 				this.env.ChatNode.get(this.env.ChatNode.idFromString(node)).fetch(`https://${this.state.id.toString()}/internal/node/data`, {
		// 					method: 'POST',
		// 					headers: {
		// 						'Content-Type': 'application/json'
		// 					},
		// 					body: JSON.stringify(data)
		// 				})
		// 			}
		// 			return c.json({ ok: true })

		// 		default:
		// 			return c.json({ ok: false, error: 'type does not match' }, 400)
		// 	}
		// })
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}

	async alarm(): Promise<void> {

	}
}
