import { Hono } from 'hono'

const app = new Hono<Bindings>()

app.get('/', async c => {
	return c.text('Hello :) this is just a test')
})

app.get('/do/list', async c => {
	try {
		return c.env.TestDO.get(
			c.env.TestDO.idFromName('1')
		).fetch('https://fake-host/list')
	} catch (error: any) {
		return c.json({ error: error.message }, 500)
	}
})

export default {
	fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
		return app.fetch(request, env, ctx)
	}
}

export class TestDO implements DurableObject {
	private app = new Hono<Bindings>()

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.state.blockConcurrencyWhile(async () => {
			const items = await this.state.storage.list({ limit: 1 })

			if (items.size === 0) {
				await this.state.storage.put({
					A: 'A', B: 'B', C: 'C', D: 'D', E: 'E',
					F: 'F', G: 'G', H: 'H', I: 'I', J: 'J',
					K: 'K', L: 'L', M: 'M', N: 'N', O: 'O',
					P: 'P', Q: 'Q', R: 'R', S: 'S', T: 'T',
					U: 'U', V: 'V', W: 'W', X: 'X', Y: 'Y',
					Z: 'Z'
				})
			}
		})

		this.app.get('/list', async c => {
			const list = await this.state.storage.list({})

			const listReverse = await this.state.storage.list({
				reverse: true
			})

			const listStartAfterE = await this.state.storage.list({
				startAfter: 'E'
			})

			const listStartAfterEReverse = await this.state.storage.list({
				startAfter: 'E',
				reverse: true
			})

			const listStartAfterEEndM = await this.state.storage.list({
				startAfter: 'E',
				end: 'M'
			})

			const listStartAfterMEndEReverse = await this.state.storage.list({
				startAfter: 'M',
				end: 'E',
				reverse: true
			})

			const listEndE = await this.state.storage.list({
				end: 'E'
			})

			const listEndEReverse = await this.state.storage.list({
				end: 'E',
				reverse: true
			})

			const listLimit3 = await this.state.storage.list({
				limit: 3
			})

			const listLimit3Reverse = await this.state.storage.list({
				limit: 3,
				reverse: true
			})

			return c.json({
				list: Array.from(list.keys()),
				listReverse: Array.from(listReverse.keys()),
				listStartAfterE: Array.from(listStartAfterE.keys()),
				listStartAfterEReverse: Array.from(listStartAfterEReverse.keys()),
				listStartAfterEEndM: Array.from(listStartAfterEEndM.keys()),
				listStartAfterMEndEReverse: Array.from(listStartAfterMEndEReverse.keys()),
				listEndE: Array.from(listEndE.keys()),
				listEndEReverse: Array.from(listEndEReverse.keys()),
				listLimit3: Array.from(listLimit3.keys()),
				listLimit3Reverse: Array.from(listLimit3Reverse.keys())
			})
		})
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}
}
