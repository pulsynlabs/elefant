type SendFn = (msg: string) => void

export class RoomManager {
	private readonly byRoom = new Map<string, Set<SendFn>>()
	private readonly bySender = new Map<SendFn, Set<string>>()

	join(send: SendFn, room: string): void {
		let members = this.byRoom.get(room)
		if (!members) {
			members = new Set<SendFn>()
			this.byRoom.set(room, members)
		}
		members.add(send)

		let senderRooms = this.bySender.get(send)
		if (!senderRooms) {
			senderRooms = new Set<string>()
			this.bySender.set(send, senderRooms)
		}
		senderRooms.add(room)
	}

	leave(send: SendFn, room: string): void {
		const members = this.byRoom.get(room)
		if (members) {
			members.delete(send)
			if (members.size === 0) this.byRoom.delete(room)
		}

		const senderRooms = this.bySender.get(send)
		if (senderRooms) {
			senderRooms.delete(room)
			if (senderRooms.size === 0) this.bySender.delete(send)
		}
	}

	leaveAll(send: SendFn): void {
		const senderRooms = this.bySender.get(send)
		if (!senderRooms) return

		for (const room of senderRooms) {
			const members = this.byRoom.get(room)
			if (!members) continue
			members.delete(send)
			if (members.size === 0) this.byRoom.delete(room)
		}

		this.bySender.delete(send)
	}

	broadcast(room: string, message: string, exclude?: SendFn): void {
		const members = this.byRoom.get(room)
		if (!members) return

		for (const send of members) {
			if (exclude && send === exclude) continue
			try {
				send(message)
			} catch {
				this.leaveAll(send)
			}
		}
	}

	rooms(): string[] {
		return [...this.byRoom.keys()]
	}

	members(room: string): number {
		return this.byRoom.get(room)?.size ?? 0
	}
}
