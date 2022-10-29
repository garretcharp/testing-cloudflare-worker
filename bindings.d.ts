interface QueueBatch<Body = unknown> {
	queue: string
	messages: {
		body: Body
		timestamp: string
		id: string
	}[]
}

type QueueEventHandler = <Body = unknown, Env extends { [key: string]: unknown } = {}>(batch: QueueBatch<Body>, env: Env) => Promise<void>

interface Queue<Body = unknown> {
	send(message: Body): Promise<void>
	sendBatch(batch: Iterable<{ body: Body }>): Promise<void>
}

interface Bindings {
	TestD1: D1Database
	AnotherD1: D1Database

	TestDO: DurableObjectNamespace

	TestQueue: Queue

	BUCKET: R2Bucket
}
