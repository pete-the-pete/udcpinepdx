import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";
import { PizzaSchema } from "./pizza.ts";
import { LiveStateSchema } from "./live-state.ts";
import { LiveEventSchema } from "./live-event.ts";
import { StartFiringRequestSchema } from "./start-firing-request.ts";
import { EndFiringRequestSchema } from "./end-firing-request.ts";
import { ExchangeRequestSchema } from "./exchange-request.ts";
import { PairingTokenSchema } from "./pairing-token.ts";
import { PizzaNextRequestSchema } from "./pizza-next-request.ts";

export {
  FiringSchema,
  SampleSchema,
  PizzaSchema,
  LiveStateSchema,
  LiveEventSchema,
  StartFiringRequestSchema,
  EndFiringRequestSchema,
  ExchangeRequestSchema,
  PairingTokenSchema,
  PizzaNextRequestSchema,
};
export type { Firing } from "./firing.ts";
export type { Sample } from "./sample.ts";
export type { Pizza } from "./pizza.ts";
export type { LiveState } from "./live-state.ts";
export type { LiveEvent, SampleEvent } from "./live-event.ts";
export type { StartFiringRequest } from "./start-firing-request.ts";
export type { EndFiringRequest } from "./end-firing-request.ts";
export type { ExchangeRequest } from "./exchange-request.ts";
export type { PairingToken } from "./pairing-token.ts";
export type { PizzaNextRequest } from "./pizza-next-request.ts";

export const ALL_SCHEMAS = {
  Firing: FiringSchema,
  Sample: SampleSchema,
  Pizza: PizzaSchema,
  LiveState: LiveStateSchema,
  LiveEvent: LiveEventSchema,
  StartFiringRequest: StartFiringRequestSchema,
  EndFiringRequest: EndFiringRequestSchema,
  ExchangeRequest: ExchangeRequestSchema,
  PairingToken: PairingTokenSchema,
  PizzaNextRequest: PizzaNextRequestSchema,
} as const;
