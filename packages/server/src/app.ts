import { defineRoom, defineServer } from 'colyseus';
import { RoundRoom } from './RoundRoom.ts';

export { RoundRoom };
export const server = defineServer({ rooms: { round: defineRoom(RoundRoom) } });
