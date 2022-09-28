import { Hono } from 'hono'

export type ReportChatters = {
	type: 'ReportChatters'
	chatters: string[]
}

export type SendMessage = {
	type: 'SendMessage'
	message: string
	sender: string
}

export type NodeMessage = {
	id: string
} & (ReportChatters | SendMessage)

export default class ChatManager implements DurableObject {
	private app = new Hono<Bindings>()

	private nodes = new Map<string, { chatters: string[] }>()

	private findChatNode() {
		for (const [id, { chatters }] of this.nodes.entries()) {
			if (chatters.length < 500) return this.env.ChatNode.get(this.env.ChatNode.idFromString(id))
		}

		const id = this.env.ChatNode.newUniqueId()
		this.state.storage.put(`ChatNodes/${id.toString()}`, '')
		this.nodes.set(id.toString(), { chatters: [] })

		return this.env.ChatNode.get(id)
	}

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.state.blockConcurrencyWhile(async () => {
			const nodes = await state.storage.list({ prefix: 'ChatNodes/' })

			// TODO: Get actual chatters list from nodes
			for (const name of nodes.keys()) {
				this.nodes.set(name.replace('ChatNodes/', ''), { chatters: [] })
			}
		})

		this.app.get('/websocket', async c => {
			if (c.req.header('upgrade') !== 'websocket') return new Response('Expected Upgrade: websocket', { status: 426 })

			return this.findChatNode().fetch(`https://${this.state.id.toString()}/websocket`, c.req)
		})

		this.app.get('/nodes', async c => {
			const nodes = await this.state.storage.list({
				prefix: 'ChatNodes/'
			})

			return c.json(Array.from(nodes.keys()))
		})

		this.app.post('/internal/node/data', async c => {
			const data = await c.req.json<NodeMessage>()

			switch(data.type) {
				case 'ReportChatters':
					this.nodes.set(data.id, { chatters: data.chatters })
					return c.json({ ok: true })
				case 'SendMessage':
					const createdAt = new Date().toISOString(), id = crypto.randomUUID()
					await this.state.storage.put(`Messages/${createdAt}/${id}`, {
						id,
						createdAt,
						sender: data.sender,
						message: data.message
					})
					for (const node of this.nodes.keys()) {
						this.env.ChatNode.get(this.env.ChatNode.idFromString(node)).fetch(`https://${this.state.id.toString()}/internal/node/data`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify(data)
						})
					}
					return c.json({ ok: true })

				default:
					return c.json({ ok: false, error: 'type does not match' }, 400)
			}
		})
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}
}
