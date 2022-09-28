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

	private chatters = new Map<string, string[]>()
	private nodes = new Map<string, WebSocket>()

	private async findChatNode() {
		for (const [id, chatters] of this.chatters.entries()) {
			if (chatters.length < 500) return this.env.ChatNode.get(this.env.ChatNode.idFromString(id))
		}

		const id = this.env.ChatNode.newUniqueId()
		this.state.storage.put(`ChatNodes/${id.toString()}`, '')

		await this.connectWebsocket(id)
		this.chatters.set(id.toString(), [])

		return this.env.ChatNode.get(id)
	}

	private async connectWebsocket(id: DurableObjectId) {
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

			this.nodes.set(id.toString(), webSocket)

			webSocket.accept()

			webSocket.send(JSON.stringify({ type: 'GetChatters' }))

			webSocket.addEventListener('message', (message) => {
				if (typeof message.data !== 'string') return

				const data = JSON.parse(message.data) as NodeMessage

				if (data.type === 'ReportChatters') this.chatters.set(id.toString(), data.chatters)
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
				[...nodes.keys()].map(async key => {
					const id = key.replace('ChatNodes/', '')

					this.chatters.set(id, [])
					await this.connectWebsocket(this.env.ChatNode.idFromString(id))
				})
			)
		})

		this.app.get('/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 })

			return (await this.findChatNode()).fetch(`https://${this.state.id.toString()}/websocket`, c.req)
		})

		this.app.get('/chatters', async c => {
			return c.json(Object.fromEntries(this.chatters.entries()))
		})

		this.app.get('/nodes', async c => {
			const data: any = {}

			for (const [id, node] of this.nodes.entries()) {
				data[id] = node.readyState
			}

			return c.json(data)
		})

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
}
