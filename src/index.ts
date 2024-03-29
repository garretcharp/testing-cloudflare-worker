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

app.get('/do/test/:number', async c => {
	try {
		const number = Number(c.req.paramData?.number ?? 100)

		for (let i = 0; i < number; i++) {
			await c.env.TestDO.get(
				c.env.TestDO.idFromName('1')
			).fetch('https://fake-host/')
		}

		return c.json({ success: true })
	} catch (error: any) {
		return c.json({ message: error.message, stack: error.stack, name: error.name }, 500)
	}
})

app.get('/do/concurrency', async c => {
	try {
		console.log('Got request, sending to DO', new Date().toISOString())

		const response = await c.env.TestDO.get(
			c.env.TestDO.idFromName('1')
		).fetch('https://fake-host/test/concurrency', {
			method: 'POST'
		})

		console.log('Got response from DO', new Date().toISOString())

		return response
	} catch (error: any) {
		return c.json({ message: error.message, stack: error.stack, name: error.name }, 500)
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

app.get('/limits', async c => {
	const object = c.env.Limits.get(
		c.env.Limits.idFromName('1')
	)

	c.env.DurableObjectLimits.writeDataPoint({
		blobs: ['All'],
		indexes: ['Requests']
	})

	try {
		const requestStart = Date.now()

		const res = await object.fetch('https://fake-host/', {
			method: 'POST'
		})

		const requestEnd = Date.now()

		if (res.status === 200)
			c.env.DurableObjectLimits.writeDataPoint({
				blobs: ['All'],
				doubles: [requestEnd - requestStart],
				indexes: ['SuccessResults']
			})
		else
			c.env.DurableObjectLimits.writeDataPoint({
				blobs: ['All', `Status ${res.status}`, await res.clone().text()],
				doubles: [requestEnd - requestStart],
				indexes: ['ErrorResults']
			})

		return res
	} catch (error: any) {
		c.env.DurableObjectLimits.writeDataPoint({
			blobs: ['All', error.name, error.message],
			indexes: ['ErrorResults']
		})

		return c.json({
			name: error.name,
			error: error.message,
			stack: error.stack
		}, 500)
	}
})

app.get('/limits/hourly', async c => {
	const object = c.env.Limits.get(
		c.env.Limits.idFromName('2')
	)

	c.env.DurableObjectLimits.writeDataPoint({
		blobs: ['Hourly'],
		indexes: ['Requests']
	})

	try {
		const requestStart = Date.now()

		const res = await object.fetch('https://fake-host/hourly', {
			method: 'POST'
		})

		const requestEnd = Date.now()

		if (res.status === 200)
			c.env.DurableObjectLimits.writeDataPoint({
				blobs: ['Hourly'],
				doubles: [requestEnd - requestStart],
				indexes: ['SuccessResults']
			})
		else
			c.env.DurableObjectLimits.writeDataPoint({
				blobs: ['Hourly', `Status ${res.status}`, await res.clone().text()],
				doubles: [requestEnd - requestStart],
				indexes: ['ErrorResults']
			})

		return res
	} catch (error: any) {
		c.env.DurableObjectLimits.writeDataPoint({
			blobs: ['Hourly', error.name, error.message],
			indexes: ['ErrorResults']
		})

		return c.json({
			name: error.name,
			error: error.message,
			stack: error.stack
		}, 500)
	}
})

app.get('/limits/delete', async c => {
	const object = c.env.Limits.get(
		c.env.Limits.idFromName('1')
	)

	try {
		const res = await object.fetch('https://fake-host/', { method: 'DELETE' })
		return res
	} catch (error: any) {
		return c.json({ error: error.message }, 500)
	}
})

app.get('/limits/delete/hourly', async c => {
	const object = c.env.Limits.get(
		c.env.Limits.idFromName('2')
	)

	try {
		const res = await object.fetch('https://fake-host/', { method: 'DELETE' })
		return res
	} catch (error: any) {
		return c.json({ error: error.message }, 500)
	}
})

app.get('/loaderio-dd6e18ef3fd2b8dcbd9da10052e1d1fa.txt', async c => {
	return c.text('loaderio-dd6e18ef3fd2b8dcbd9da10052e1d1fa')
})

export default {
	async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
		return app.fetch(request, env, ctx)
	},
	async queue(batch: MessageBatch<any>) {
		console.log(JSON.stringify({
			count: batch.messages.length,
			messages: batch.messages
		}))
	}
}

export class TestDO implements DurableObject {
	private app = new Hono<Bindings>()

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.get('/', async c => c.text('Hello!'))

		this.app.get('/d1-in-do', async c => {
			try {
				const statement = c.env.TestD1.prepare('SELECT * FROM Test')

				const result = await statement.all()

				return c.json(result)
			} catch (error: any) {
				return c.json({ error: error.message }, 500)
			}
		})

		this.app.post('/test/concurrency', async c => {
			console.log('Received request in DO', new Date().toISOString())

			const value = await this.state.storage.get<number>('value') ?? 0

			await scheduler.wait(3000)

			await this.state.storage.put('value', value + 1)

			console.log('Finished waiting in DO', new Date().toISOString())

			return c.json({ value: value + 1 })
		})
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}
}

export class Limits implements DurableObject {
	private app = new Hono<Bindings>()

	constructor(private state: DurableObjectState, private env: Bindings) {
		this.app.post('/', async c => {
			try {
				const requests = await this.state.storage.get<number>(`Requests`) ?? 0
				await this.state.storage.put(`Requests`, requests + 1)

				return c.json({ requests: requests + 1 })
			} catch (error: any) {
				return c.json({ error: error.message }, 500)
			}
		})

		this.app.post('/hourly', async c => {
			try {
				const date = new Date(), key = `Requests/${date.toISOString().split('T')[0]}`, hour = date.getUTCHours()
				const requests = await this.state.storage.get<number[]>(key) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
				requests[hour] = requests[hour] + 1
				await this.state.storage.put(key, requests)

				return c.json({ requests })
			} catch (error: any) {
				return c.json({ error: error.message }, 500)
			}
		})

		this.app.delete('/', async c => {
			try {
				await this.state.storage.deleteAll()

				return c.json({ success: true })
			} catch (error: any) {
				return c.json({ error: error.message }, 500)
			}
		})
	}

	async fetch(request: Request) {
		return this.app.fetch(request, this.env)
	}
}
