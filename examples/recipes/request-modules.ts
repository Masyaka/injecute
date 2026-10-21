import {
  type ContainerServices,
  DIContainer,
  type ServiceRegistry,
} from 'injecute';

export const log: string[] = [];

class Transaction {
  #committed = false;
  constructor(readonly id: number) {}
  query(sql: string): void {
    log.push(`tx${this.id}: ${sql}`);
  }
  commit(): void {
    this.#committed = true;
    log.push(`tx${this.id}: commit`);
  }
  [Symbol.dispose](): void {
    if (!this.#committed) log.push(`tx${this.id}: rollback`);
  }
}

export class Database {
  #next = 1;
  constructor(readonly name = 'postgres') {}
  begin(): Transaction {
    const tx = new Transaction(this.#next++);
    tx.query(`begin on ${this.name}`);
    return tx;
  }
}

class Gateway {
  readonly name = 'stripe';
}

class OrderRepository {
  constructor(private readonly tx: Transaction) {}
  insert(item: string): void {
    this.tx.query(`insert ${item}`);
  }
}

export interface Payments {
  charge(amount: number): void;
}

class GatewayPayments implements Payments {
  constructor(
    private readonly tx: Transaction,
    private readonly gateway: Gateway,
  ) {}
  charge(amount: number): void {
    this.tx.query(`charge ${amount} via ${this.gateway.name}`);
  }
}

class Checkout {
  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: Payments,
    private readonly tx: Transaction,
  ) {}

  placeOrder(item: string, quantity: number): void {
    this.orders.insert(item);
    if (quantity < 1) throw new Error('quantity must be at least 1');
    this.payments.charge(quantity * 10);
    this.tx.commit();
  }
}

// #region request-modules
// orders/orders.container.ts: the feature's two modules

/** What the app shares: registered once, in the root. */
export const addOrders = (c: ServiceRegistry) =>
  c.addSingleton('gateway', Gateway);

/** What one request owns: registered in each request's fork. */
export const addOrdersRequest = (
  c: ServiceRegistry<{ db: Database; gateway: Gateway }>,
) =>
  c
    .addSingleton('tx', (db) => db.begin(), ['db'])
    .addSingleton('orders', OrderRepository, ['tx'])
    .addSingleton(
      'payments',
      (tx, gateway): Payments => new GatewayPayments(tx, gateway),
      ['tx', 'gateway'],
    )
    .addSingleton('checkout', Checkout, ['orders', 'payments', 'tx']);

// container.ts: the composition root applies the root modules

export const createApp = () =>
  new DIContainer().addSingleton('db', Database).extend(addOrders).seal();

export type App = ReturnType<typeof createApp>;

/** Every feature's request module, in one place. */
export const addRequestModules = (c: ServiceRegistry<ContainerServices<App>>) =>
  c.extend(addOrdersRequest);

// server.ts: one fork per request, in one place, disposed at the end

export const createHandler =
  (app: App, addRequest = addRequestModules) =>
  async (item: string, quantity: number): Promise<void> => {
    await using scope = app.fork().extend(addRequest);
    scope.get('checkout').placeOrder(item, quantity);
  };
// #endregion request-modules

export const app = createApp();
export const handle = createHandler(app);

// #region request-modules-test
// A root dependency: request forks of an isolated fork are built with its replacement.
const testApp = createApp()
  .fork({ isolated: true })
  .addInstance('db', new Database('memory'), { replace: true });
await createHandler(testApp)('book', 1); // tx1: begin on memory, …

// A per-request service: the handler applies the request modules, then the replacement.
export const charged: number[] = [];
const fakePayments: Payments = {
  charge: (amount) => void charged.push(amount),
};
await createHandler(app, (c) =>
  addRequestModules(c).addInstance('payments', fakePayments, { replace: true }),
)('pen', 2); // charged: [20]
// #endregion request-modules-test
