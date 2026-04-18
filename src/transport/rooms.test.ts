import { describe, expect, it } from 'bun:test'

import { RoomManager } from './rooms.ts'

describe('RoomManager', () => {
	it('adds members on join and reports member counts', () => {
		const manager = new RoomManager()
		const sendA = (_msg: string) => {}
		const sendB = (_msg: string) => {}

		manager.join(sendA, 'project:p1')
		manager.join(sendB, 'project:p1')

		expect(manager.members('project:p1')).toBe(2)
		expect(manager.rooms()).toEqual(['project:p1'])
	})

	it('removes a member from a room', () => {
		const manager = new RoomManager()
		const send = (_msg: string) => {}

		manager.join(send, 'session:s1')
		expect(manager.members('session:s1')).toBe(1)

		manager.leave(send, 'session:s1')
		expect(manager.members('session:s1')).toBe(0)
		expect(manager.rooms()).toEqual([])
	})

	it('broadcasts to all room members and supports exclusion', () => {
		const manager = new RoomManager()
		const receivedA: string[] = []
		const receivedB: string[] = []

		const sendA = (msg: string) => {
			receivedA.push(msg)
		}
		const sendB = (msg: string) => {
			receivedB.push(msg)
		}

		manager.join(sendA, 'approval:c1')
		manager.join(sendB, 'approval:c1')

		manager.broadcast('approval:c1', 'all')
		manager.broadcast('approval:c1', 'skip-a', sendA)

		expect(receivedA).toEqual(['all'])
		expect(receivedB).toEqual(['all', 'skip-a'])
	})

	it('leaveAll removes a sender from all rooms', () => {
		const manager = new RoomManager()
		const send = (_msg: string) => {}
		const other = (_msg: string) => {}

		manager.join(send, 'room:a')
		manager.join(send, 'room:b')
		manager.join(other, 'room:b')

		manager.leaveAll(send)

		expect(manager.members('room:a')).toBe(0)
		expect(manager.members('room:b')).toBe(1)
		expect(manager.rooms()).toEqual(['room:b'])
	})

	it('removes dead senders when broadcast throws', () => {
		const manager = new RoomManager()
		const liveReceived: string[] = []

		const dead = (_msg: string) => {
			throw new Error('socket closed')
		}
		const live = (msg: string) => {
			liveReceived.push(msg)
		}

		manager.join(dead, 'room:dead')
		manager.join(live, 'room:dead')

		manager.broadcast('room:dead', 'payload')
		manager.broadcast('room:dead', 'next')

		expect(liveReceived).toEqual(['payload', 'next'])
		expect(manager.members('room:dead')).toBe(1)
	})
})
