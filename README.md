# injecute

Lightweight extendable typesafe dependency injection container written in TypeScript.

![Build and tests](https://github.com/Masyaka/injecute/actions/workflows/tests.yml/badge.svg)

### Key features

- typesafe
- explicit dependencies by default
- extensibility
- browser / node environments support
- nested containers
- no transpiling required

## Motivation

Most existing DI containers heavily rely on decorators and use them as main approach to manage dependencies.
But it leads us to breaking the IOC principle and our business code become dependent on concrete library that provides container and decorators.
We can handle it by creating proxy classes which created for bounding derived class to container, but it leads us to unnecessary boilerplate code.

Solution is not use the decorators as default way to register services.

## How to use

1. Create container
2. Add services
3. Get your services or use `.injecute` method when needed.

### Basic usage

```typescript
interface IDependency {
  value: number;
  method(): string;
}

class NotBasicService {
  constructor(srv: IDependency, logger: Logger) {}
}

const container = new DIContainer()
  .addInstance('logger', console)
  .addSingleton(
    'myService',
    (): IDependency => ({
      value: 42,
      method() {
        return 'The answer';
      },
    }),
    [],
  )
  .addTransient('notBasicService', construct(NotBasicService), [
    'myService',
    'logger',
  ]);

// TS will know that notBasicService is the NotBasicService;
const notBasicService = container.get('notBasicService');

assert(myDependantService instanceof NotBasicService);
```

### Services registration

Constructors and functions (factories) supported. You can add your ready to use instances as well.

#### Service types

- Singleton

  Instantiated/executed once. Each time will return the same result.

- Transient

  Each time will be created new instance.

- Instance

  Created outside of container instance.

Each added service will change the result type of container.
So you should to add services in initialization order low level services first.

### Configuration based service

```typescript
type Logger = {
  log: (logLevel: string, message: string) => void;
};

const config = {
  useProductionLogger: process.env.USE_PRODUCTION_LOGGER === 'true',
};

class LoggerUsingService {
  constructor(logger: Logger) {}
}

const container = new DIContainer()
  .addSingleton('productionLogger', productionLoggerFactory, [])
  .addInstance('console', console)
  .addAlias(
    'logger',
    config.useProductionLogger ? 'productionLogger' : 'console',
  )
  .addTransient('service', construct(LoggerUsingService), ['logger']);

// service will use as logger `productionLogger` or `console` based on config.;

const service = container.get('service');
```

### Nested containers

Containers nesting allows to keep local services out of parent context but use the parents services.
All services registered in parent container can be accessed seamlessly.
There is two ways to derive container.

- Put the parent container as argument of new container.
- Use `.fork()` method. In this case child container will use same resolvers and middlewares. It can be changed by providing optional argument.

```javascript
import { DIContainer } from './container';
import * as Express from 'express';

const server = new Express();
const rootContainer = new DIContainer()
  .addInstance('logger', console)
  .addSingleton(
    'db',
    (logger) => {
      /* some db init with logger */
    },
    ['logger'],
  );

const addContainerMiddlewareCreator = (container) => (req, res, next) => {
  // lazy create container with lazy user resolving
  // this container will have access to all `rootContainer` services but adding services to this container will not modify root container
  req.getContainer = () =>
    container
      .fork() // make nested service
      .addSingleton(
        'userId',
        () => {
          /* get user id from req, from the auth header for example */
        },
        [],
      )
      .addSingleton('user', (userId, db) => db.getUserById(userId), [
        'userId',
        'db',
      ])
      .addSingleton(
        'businessService',
        async (user) => new MyBusinessService(await user),
        ['user'],
      );
  // add other request related stuff for exapmle apm / audit based on user / business services bounded to user or request
  next();
};
server.use(addContainerMiddlewareCreator(rootContainer));

server.get('/api/business', (req, res) => {
  req
    .getContainer()
    .get('businessService')
    .then((srv) => {
      // src.user is the resolved user from some auth data
      req.json(srv.doMyBusiness());
    });
});
```

Or you can not mutate the `req` by adding the `getContainer` function and use "functional" approach:

```typescript
export const createRequestContainerWrapper = <
  RootServices extends Record<ArgumentsKey, any>,
  RequestServices extends Record<ArgumentsKey, any>,
>(
  container: IDIContainer<RootServices>,
  extension: IDIContainerExtension<
    RootServices & { req: Request },
    RequestServices
  >,
) => {
  return <
      Keys extends readonly (keyof RequestServices)[],
      RequiredServices extends DependenciesTypes<RequestServices, Keys>,
    >(
      servicesNames: [...Keys],
      handlerCreator: Callable<RequiredServices, Handler>,
    ): Handler =>
    (req, res, next) => {
      const targetHandler = container
        // make nested service
        .fork()
        // add request to container
        .addInstance('req', req)
        // apply extension which will register services related to request context
        .extend(extension)
        // create handler using required services from container
        .injecute<Handler, any, any>(handlerCreator, servicesNames);

      targetHandler(req, res, next);
    };
};

const rootContainer = new DIContainer().addSingleton(
  'userResolvingService',
  construct(UserResolvingService),
  ['db', 'etc...'],
);

const useRequestContainer = createRequestContainerWrapper(
  rootContainer,
  (c) => {
    return (
      c
        // get token from request
        .addSingleton('authToken', (req) => req.headers['Authorization'], [
          'req',
        ])
        // get user by token using service from root container
        .addSingleton(
          'user',
          (userResolvingService, token) =>
            userResolvingService.getUserByToken(token),
          ['userResolvingService', 'authToken'],
        )
        // use user in RequestContextService constructor
        .addSingleton('requestContextService', RequestContextService, ['user'])
    );
    // Add more your request related services here
  },
);

app.post(
  '/api/user-stuff',
  useRequestContainer(
    ['requestContextService'],
    (requestContextService) => (req, res) => {
      res.send(requestContextService.doUserRelatedStuff(req.body));
    },
  ),
);
```

### Injecute

Best way to use container is hiding container with some helpers. Injecute will help there.

```typescript
import { default as Express, Handler } from 'express';
import {
  ArgumentsKey,
  DependenciesTypes,
  DIContainer,
  Func,
  IDIContainer,
} from 'injecute';

// helper that helps to pull services from container
export const useContainerServices =
  <S extends Record<ArgumentsKey, any>>(container: IDIContainer<S>) =>
  <
    Keys extends readonly (keyof S)[],
    RequiredServices extends DependenciesTypes<S, Keys>,
    H extends Func<RequiredServices, Handler>,
  >(
    servicesNames: [...Keys],
    handlerCreator: H,
  ): Handler => {
    return container.injecute<() => Handler, any, any>(
      handlerCreator,
      servicesNames,
    );
  };

// business stuff service
class MyBusinessService {
  constructor(private readonly logger: any) {}

  doBusinessStuff(parameter: string) {
    this.logger.log(parameter);
    return Number(parameter);
  }
}

// root app container
const c = new DIContainer()
  .addInstance('logger', console)
  .addSingleton('businessService', construct(MyBusinessService), ['logger']);

// handler creator bounded to your app container
const useServices = useContainerServices(c);

const app = Express();

// use handler on route
app.use(
  '/api/business/stuff/:id',
  useServices(['businessService'], (service) => (req, res, next) => {
    res.json(service.doBusinessStuff(req.params.id));
  }),
);

app.listen(3000);
c.get('logger').log('Listening at port 3000');
```

### OOP factories

For OOP style factory classes you can create own helper.

```typescript
type IFactory<D, T> = {
  build: (args: D) => T;
};

function useOopFactory<D, T>(factory: IFactory<D, T>) {
  return (args: D) => factory.build(args);
}

container.addSingleton(
  'serviceFromFactory',
  useOopFactory(new ConcreteFactory()),
  ['some D'],
);
```

### Extensions

Extensions are allows to add batch services from some module.
Also, it allows to add service without breaking the chaining

```typescript
function addLoggingServices(config) {
  return (c) =>
    c
      .addSingleton('elkUrl', () => config.ELK_URL, [])
      .addSingleton('elkLogger', (url) => ElkLogger(url), ['elkUrl'])
      .addInstance('console', console)
      .addAlias(
        'logger',
        config.NODE_ENV === 'production' ? 'elkLogger' : 'console',
      );
}

container
  .extend(addLoggingServices(config))
  .extend(addCryptoModules)
  .extend(addBusinessServices);
```

```typescript
const p = new DIContainer().addTransient('s', () => ({ x: 1 }), []);

const c = new DIContainer(p).extend((c) => {
  const s = c.get('s');
  return c.addTransient('s', () => ({ ...s, y: 2 }), []);
});

expect(c.get('s')).to.be.eql({ x: 1, y: 2 });
```

### Middlewares

Allows to add some logic before and/or after service resolving.

You can add logging or implement own strategies of resolving dependencies.

You have access to container as `this` in middleware.

```typescript
container.use(function (key, next) {
  const willCreateNewInstance = !this.instances[key] && !!this.factories[key];
  if (willCreateNewInstance) {
    this.get('logger').debug(`New instance will be created for ${key} key.`);
  }

  return next(key);
});
```
