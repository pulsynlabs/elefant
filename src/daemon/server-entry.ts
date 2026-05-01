import { loadConfig } from '../config/index.ts'
import { fetchRegistries } from '../tools/skill/registry-fetcher.js'
import { createDaemon } from './create.ts'
import { acquireDaemonLock } from './pid.ts'
import { gracefulShutdown } from './shutdown.ts'

const lockResult = acquireDaemonLock()
if (!lockResult.ok) {
	console.error(`[elefant] ${lockResult.error.message}`)
	process.exit(1)
}

const lock = lockResult.data

process.on('exit', () => { lock.release() })

const configResult = await loadConfig()
if (!configResult.ok) {
	console.error('[elefant] Config error:', configResult.error.message)
	process.exit(1)
}

const config = configResult.data
if (config.skills?.registries?.some((registry) => registry.enabled !== false)) {
	void fetchRegistries(config.skills).catch((err) => {
		console.warn('[skills] Registry fetch startup error:', err)
	})
}

const daemonResult = await createDaemon(config)
if (!daemonResult.ok) {
	console.error('[elefant] Daemon error:', daemonResult.error.message)
	process.exit(1)
}

process.on('SIGTERM', () => {
	lock.release()
	void gracefulShutdown('SIGTERM', daemonResult.data)
})
process.on('SIGINT', () => {
	lock.release()
	void gracefulShutdown('SIGINT', daemonResult.data)
})

await daemonResult.data.start()
