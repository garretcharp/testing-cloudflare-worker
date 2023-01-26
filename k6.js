import http from 'k6/http'

export const options = {
	scenarios: {
		open_model: {
			executor: 'constant-arrival-rate',
			rate: 1000,
			timeUnit: '1s',
			duration: '5m',
			preAllocatedVUs: 3000
		},
	},
	userAgent: 'Testing Garret / 1.0.0',
	discardResponseBodies: true
}

export default function () {
	http.get('https://testing.garretcharp.com/limits/hourly')
	// http.get('https://testing.garretcharp.com/limits?concurrency')
}
