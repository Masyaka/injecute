import {
  type ContainerServices,
  DIContainer,
  type ServiceProvider,
  type ServiceRegistry,
} from 'injecute';

class Database {
  query(): string[] {
    return [];
  }
}

// #region provider
// Consumers declare the services they use; any container that has them is accepted.
function listUsers(services: ServiceProvider<{ db: Database }>): string[] {
  return services.get('db').query();
}
// #endregion provider

// #region registry
// Modules receive a registry: they can register, but not add middlewares, fork or dispose.
const addUsers = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('users', (db) => ({ list: () => db.query() }), ['db']);
// #endregion registry

// #region container
// The composition root owns the container and wires everything together.
const app = new DIContainer().addSingleton('db', Database).extend(addUsers);

listUsers(app);

type AppServices = ContainerServices<typeof app>; // { db: Database } & { users: … }
// #endregion container

export { app, listUsers, type AppServices };
