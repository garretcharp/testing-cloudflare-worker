import { Hono } from 'hono'

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

app.get('/old/d1/insert', async c => {
	const statement = c.env.AnotherD1.prepare('INSERT INTO Test (name) VALUES (?) RETURNING *')

	const result = await statement.bind(c.req.query('name') ?? 'My cool test item').first()

	return c.json(result)
})

app.get('/old/d1/select', async c => {
	const statement = c.env.AnotherD1.prepare('SELECT * FROM Test')

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

app.get('/queue', async c => {
	try {
		const start = Date.now()

		await c.env.TestQueue.send({ testing: true })

		return c.json({ success: true, time: Date.now() - start })
	} catch (error: any) {
		return c.json({
			name: error.name,
			error: error.message,
			stack: error.stack
		}, 500)
	}
})

app.get('/loaderio-dd6e18ef3fd2b8dcbd9da10052e1d1fa.txt', async c => {
	return c.text('loaderio-dd6e18ef3fd2b8dcbd9da10052e1d1fa')
})

export default {
	async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
		return app.fetch(request, env, ctx)
	},
	async queue(batch: QueueBatch) {
		console.log(JSON.stringify({
			count: batch.messages.length,
			messages: batch.messages
		}))
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
