```typescript
import { Server as WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { promisify } from 'util';
import * as protobuf from 'protobufjs';

interface ClientInfo {
  id: string;
  socket: WebSocket;
  pollingRate: number;
  pollingInterval?: NodeJS.Timeout;
  isAlive: boolean;
}

const PORT = 8080;
const MIN_POLLING_RATE = 500; // ms
const MAX_POLLING_RATE = 65535000; // ms

// Load protobuf definitions
const protoRootPromise = protobuf.load('sensor.proto');
type GlucoseDataPayload = { timestamp: number; glucoseLevel: number };

// Message types (must match proto file)
let GlucoseData: protobuf.Type;
let AckMessage: protobuf.Type;
let ClientConfig: protobuf.Type;

(async () => {
  const root = await protoRootPromise;
  GlucoseData = root.lookupType('sensor.GlucoseData');
  AckMessage = root.lookupType('sensor.Acknowledgment');
  ClientConfig = root.lookupType('sensor.ClientConfig');

  startServer();
})();

function startServer() {
  const wss = new WebSocketServer({ port: PORT });

  const clients = new Map<string, ClientInfo>();

  wss.on('connection', (ws) => {
    const clientId = randomUUID();
    const clientInfo: ClientInfo = {
      id: clientId,
      socket: ws,
      pollingRate: 1000,
      isAlive: true,
    };

    clients.set(clientId, clientInfo);

    ws.on('pong', () => {
      clientInfo.isAlive = true;
    });

    // Send acknowledgment on connect
    sendAcknowledgment(ws, clientId);

    // Listen for messages (expecting configuration commands)
    ws.on('message', (data) => {
      try {
        // Expect ClientConfig message
        const msg = ClientConfig.decode(new Uint8Array(data));
        const obj = ClientConfig.toObject(msg) as { pollingRate: number };

        if (
          typeof obj.pollingRate === 'number' &&
          obj.pollingRate >= MIN_POLLING_RATE &&
          obj.pollingRate <= MAX_POLLING_RATE
        ) {
          updatePollingRate(clientInfo, obj.pollingRate);
        }
      } catch {
        // Ignore invalid protobuf or unknown messages
      }
    });

    ws.on('close', () => {
      clearPolling(clientInfo);
      clients.delete(clientId);
    });

    ws.on('error', () => {
      clearPolling(clientInfo);
      clients.delete(clientId);
    });

    // Initialize polling for this client
    updatePollingRate(clientInfo, clientInfo.pollingRate);
  });

  // Heartbeat to detect dead connections
  const interval = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.isAlive) {
        client.socket.terminate();
        clearPolling(client);
        clients.delete(client.id);
        continue;
      }
      client.isAlive = false;
      client.socket.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  function updatePollingRate(client: ClientInfo, rate: number) {
    if (client.pollingInterval) clearInterval(client.pollingInterval);
    client.pollingRate = rate;
    client.pollingInterval = setInterval(async () => {
      try {
        const glucoseMessage = createGlucoseDataMessage();
        client.socket.send(glucoseMessage, (err) => {
          if (err) {
            clearPolling(client);
            clients.delete(client.id);
            client.socket.terminate();
          }
        });
      } catch {
        // On serialization or send error, terminate client
        clearPolling(client);
        clients.delete(client.id);
        client.socket.terminate();
      }
    }, rate);
  }

  function clearPolling(client: ClientInfo) {
    if (client.pollingInterval) {
      clearInterval(client.pollingInterval);
      client.pollingInterval = undefined;
    }
  }

  function sendAcknowledgment(ws: WebSocket, clientId: string) {
    const ackPayload = { clientId };
    const errMsg = AckMessage.verify(ackPayload);
    if (errMsg) throw new Error(`Invalid ack payload: ${errMsg}`);
    const message = AckMessage.encode(AckMessage.create(ackPayload)).finish();
    ws.send(message, (err) => {
      if (err) ws.terminate();
    });
  }

  function createGlucoseDataMessage(): Uint8Array {
    // Simulate glucose data generation
    const payload: GlucoseDataPayload = {
      timestamp: Date.now(),
      glucoseLevel: randomGlucoseLevel(),
    };
    const errMsg = GlucoseData.verify(payload);
    if (errMsg) throw new Error(`Invalid glucose data: ${errMsg}`);
    return GlucoseData.encode(GlucoseData.create(payload)).finish();
  }

  function randomGlucoseLevel() {
    // Simulate glucose level between 70 and 180 mg/dL
    return Math.floor(Math.random() * 110) + 70;
  }

  console.log(`Sensor API WebSocket server running on ws://localhost:${PORT}/`);
}
```
