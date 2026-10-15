import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Board, Person } from '../shared/types';

export function person(id: string, fields: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    tags: [],
    traits: [],
    strengths: '',
    closeness: 3,
    x: 0,
    y: 0,
    updatedAt: '2026-10-15T00:00:00.000Z',
    ...fields,
  };
}

export function board(people: Person[] = []): Board {
  return { version: 1, people, relations: [], updatedAt: '2026-10-15T00:00:00.000Z' };
}

export async function serverUrl(server: Server): Promise<string> {
  if (!server.listening) await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  await closed;
}
