import { DIContainer } from 'injecute';

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

class Database {
  #next = 1;
  begin(): Transaction {
    return new Transaction(this.#next++);
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

class Payments {
  constructor(
    private readonly tx: Transaction,
    private readonly gateway: Gateway,
  ) {}
  charge(amount: number): void {
    this.tx.query(`charge ${amount} via ${this.gateway.name}`);
  }
}

// #region request-scope
const app = new DIContainer()
  .addSingleton('db', Database)
  .addSingleton('gateway', Gateway);

// Several services share one transaction and also need the app's services: the fork wires them,
// and disposes the transaction at the end (rolled back unless committed).
export async function placeOrder(item: string, quantity: number) {
  await using scope = app
    .fork()
    .addSingleton('tx', (db) => db.begin(), ['db'])
    .addSingleton('orders', OrderRepository, ['tx'])
    .addSingleton('payments', Payments, ['tx', 'gateway']);

  scope.get('orders').insert(item);
  if (quantity < 1) throw new Error('quantity must be at least 1');
  scope.get('payments').charge(quantity * 10);
  scope.get('tx').commit();
}
// #endregion request-scope

export { app };
