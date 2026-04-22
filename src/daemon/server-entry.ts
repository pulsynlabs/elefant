import { loadConfig } from '../config/index.ts'
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

const daemonResult = await createDaemon(configResult.data)
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
