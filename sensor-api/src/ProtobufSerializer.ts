```typescript
import protobuf from "protobufjs";

const protoSchema = `
syntax = "proto3";

message GlucoseLevel {
  int64 timestamp = 1;
  float value = 2;
  enum Unit {
    MGDL = 0;
    MMOLL = 1;
  }
  Unit unit = 3;
}

message Ack {
  enum Status {
    OK = 0;
    ERROR = 1;
  }
  Status status = 1;
  string message = 2;
}

message ClientRequest {
  oneof payload {
    GlucoseLevel glucoseLevel = 1;
    Ack ack = 2;
  }
}
`;

interface IGlucoseLevel {
  timestamp: number | Long;
  value: number;
  unit: GlucoseLevel_Unit;
}

enum GlucoseLevel_Unit {
  MGDL = 0,
  MMOLL = 1,
}

interface IAck {
  status: Ack_Status;
  message?: string;
}

enum Ack_Status {
  OK = 0,
  ERROR = 1,
}

interface IClientRequest {
  glucoseLevel?: IGlucoseLevel;
  ack?: IAck;
}

let root: protobuf.Root;
let GlucoseLevelMessage: protobuf.Type;
let AckMessage: protobuf.Type;
let ClientRequestMessage: protobuf.Type;

function initialize() {
  root = protobuf.parse(protoSchema).root;
  GlucoseLevelMessage = root.lookupType("GlucoseLevel");
  AckMessage = root.lookupType("Ack");
  ClientRequestMessage = root.lookupType("ClientRequest");
}
initialize();

function validatePayload<T>(messageType: protobuf.Type, payload: T): void {
  const errMsg = messageType.verify(payload);
  if (errMsg) {
    throw new Error(`Validation failed: ${errMsg}`);
  }
}

export function encodeGlucoseLevel(glucoseLevel: IGlucoseLevel): Uint8Array {
  validatePayload(GlucoseLevelMessage, glucoseLevel);
  const message = GlucoseLevelMessage.create(glucoseLevel);
  // Encode at minimal buffer size, protobufjs manages buffer internally
  return GlucoseLevelMessage.encode(message).finish();
}

export function encodeAck(ack: IAck): Uint8Array {
  validatePayload(AckMessage, ack);
  const message = AckMessage.create(ack);
  return AckMessage.encode(message).finish();
}

export function encodeClientRequest(request: IClientRequest): Uint8Array {
  // Only oneof field must be set
  if (
    (request.glucoseLevel && request.ack) ||
    (!request.glucoseLevel && !request.ack)
  ) {
    throw new Error("ClientRequest must have exactly one payload set");
  }
  if (request.glucoseLevel) {
    validatePayload(GlucoseLevelMessage, request.glucoseLevel);
  }
  if (request.ack) {
    validatePayload(AckMessage, request.ack);
  }
  const message = ClientRequestMessage.create(request);
  return ClientRequestMessage.encode(message).finish();
}

export function decodeClientRequest(buffer: Uint8Array): IClientRequest {
  let decoded;
  try {
    decoded = ClientRequestMessage.decode(buffer);
  } catch (err) {
    throw new Error(`Unable to decode ClientRequest: ${err}`);
  }
  const object = ClientRequestMessage.toObject(decoded, {
    longs: Number, // Convert int64 to number safely if possible
    enums: Number,
    defaults: false,
    arrays: false,
    objects: false,
  });
  return object as IClientRequest;
}
```