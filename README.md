# injecute
Lightweight extendable typesafe dependency injection container

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

### Basic usage
```typescript
class MyService {
}

class MyDependentService {
  constructor(srv: MyService, logger: Logger) {
  }
}

const container = new DIContainer()
  .addSingleton('myService', MyService, [])
  .addInstance('logger', console)
  .addTransient('myDependantService', MyDependentService, ['myService', 'logger'])

// TS will know that myDependantService is the MyDependentService;

const myDependantService = container.get('myDependantService');

assert(myDependantService instanceof MyDependentService)
```

### Configuration based service

```typescript
type Logger = {
  log: (logLevel: string, message: string) => void
}

const config = {
  useProductionLogger: process.env.USE_PRODUCTION_LOGGER === 'true'
}

class LoggerUsingService {
  constructor(logger: Logger) {
  }
}

const container = new DIContainer()
  .addSingleton('productionLogger', productionLoggerFactory, [])
  .addInstance('console', console)
  .addAlias('logger', config.useProductionLogger ? 'productionLogger' : 'console')
  .addTransient('service', LoggerUsingService, ['logger'])

// service will use as logger `productionLogger` or `console` based on config.;

const service = container.get('service');
```

### Nested containers

```javascript
import { DIContainer } from './container';
import * as Express from 'express'; 

const server = new Express();
const rootContainer = new DIContainer()
  .addInstance('logger', console)
  .addSingleton('db', (logger) => { /* some db init with logger */ }, ['logger'])

const addContainerMiddlewareCreator = (container) => (req, res, next) => {
  // lazy create container with lazy user resolving
  // this container will have access to all `rootContainer` services but adding services to this container will not modify root container
  req.getContainer = () => container
          .fork() // make nested service
          .addSingleton('userId', () => {/* get user id from req, from the auth header for example */}, [])
          .addSingleton('user', (userId, db) => db.getUserById(userId), ['userId', 'db'])
          .addSingleton('businessService', async (user) => new MyBusinessService(await user), ['user']) 
          // add other request related stuff for exapmle apm / audit based on user / business services bounded to user or request
  next()
}
server.use(addContainerMiddlewareCreator(rootContainer))

server.get('/api/business', (req, res) => {
  req.getContainer().get('businessService').then((srv) => {
    // src.user is the resolved user from some auth data
    req.json(srv.doMyBusiness())
  })
})
```

Or you can not mutate the `req` by adding the `getContainer` function and use "functional" approach:

```typescript
export const createRequestContainerWrapper = <RootServices extends Record<ArgumentsKey, any>, RequestServices extends Record<ArgumentsKey, any>>(container: IDIContainer<RootServices>, extension: IDIContainerExtension<RootServices & { req: Request }, RequestServices>) => {
  return <Keys extends readonly (keyof RequestServices)[], RequiredServices extends DependenciesTypes<RequestServices, Keys>>(servicesNames: [...Keys], handlerCreator: Callable<RequiredServices, Handler>): Handler => (req, res, next) => {
    const targetHandler = container
            // make nested service
            .fork()
            // add request to container
            .addInstance("req", req)
            // apply extension which will register services related to request context
            .extend(extension)
            // create handler using required services from container
            .injecute<Handler, any, any>(handlerCreator, servicesNames);

    targetHandler(req, res, next);
  };
};

const rootContainer = new DIContainer()
        .addSingleton('userResolvingService', UserResolvingService, ['db', 'etc...']);

const useRequestContainer = createRequestContainerWrapper(rootContainer, (c) => {
  return c
          // get token from request
          .addSingleton('authToken', (req) => req.headers['Authorization'], ['req'])
          // get user by token using service from root container
          .addSingleton('user', (userResolvingService, token) => userResolvingService.getUserByToken(token), ['userResolvingService', 'authToken'])
          // use user in RequestContextService constructor
          .addSingleton('requestContextService', RequestContextService, ['user']);
          // Add more your request related services here
})

app.post('/api/user-stuff', useRequestContainer(['requestContextService'], (requestContextService) => (req, res) => {
  res.send(requestContextService.doUserRelatedStuff(req.body))
}));
```

### Injecute
Best way to use container is hiding container with some helpers. Injecute will help there.
```typescript
// helper that helps to pull services from container
export const useContainerServices =
  <S extends Record<ArgumentsKey, any>>(container: IDIContainer<S>) =>
  <
    Keys extends readonly (keyof S)[],
    RequiredServices extends DependenciesTypes<S, Keys>
  >(
    servicesNames: [...Keys],
    handlerCreator: Callable<RequiredServices, Handler>
  ): Handler => {
    return container.injecute<Handler, any, any>(handlerCreator, servicesNames);
  };

// business stuff service
class MyBusinessService {
  constructor(private readonly logger: any) {}

  doBusinessStuff(parameter: string) {
    this.logger.log(parameter);
    return 42;
  }
}

// root app container
const c = new DIContainer()
  .addInstance("logger", console)
  .addSingleton("businessService", MyBusinessService, ['logger']);

// handler creator bounded to your app container
const useServices = useContainerServices(c);

// the result helper which uses MyBusinessService to handle the request.
const handler = useServices(
  ["businessService"],
  (service) => (req, res, next) => {
    res.send(service.doBusinessStuff(req.params.parameterFromRoute));
  }
);

// use handler on route
app.use('api/business/stuff', handler);
```

### OOP factories
For OOP style factory classes you can create own helper.
```typescript
type IFactory<D, T> = {
  build: (args: D) => T
}

function useOopFactory<D, T>(factory: IFactory<D, T>){
  return (args: D) => factory.build(args)
}

container.addSingleton('serviceFromFactory', useOopFactory(new ConcreteFactory()), ['some D'])
```

### Extensions
Extensions are allows to add batch services from some module.
Also, it allows to add service without breaking the chaining
```typescript
function addLoggingServices(config) {
  return (c) => c.addSingleton('elkUrl', () => config.ELK_URL, [])
          .addSingleton('elkLogger', (url) => ElkLogger, ['elkUrl'])
          .addInstance('console', console)
          .addAlias('logger', config.NODE_ENV === 'production' ? 'elkLogger' : 'console');
}

container.extend(addLoggingServices(config));
```

### Middlewares
Allows to add some logic before and/or after service resolving.

You can add logging or implement own strategies of resolving dependencies.

You have access to container as `this` in middleware.

```typescript
container.use(function (key, next) {
  const willCreateNewInstance = !this.instances[key] && !!this.factories[key];
  const instanceMessage = willCreateNewInstance ? 'New instance will be created.' : 'Existing instance will be used.';
  this.get('logger').debug(`Resolving ${key}. ${instanceMessage}`);
  return next(key);
});
```

## TODO's


- TODO: Support child container first resolving strategy.
  It can be done by collecting vertical projection of existing instances and factories.
  Steps:
  1) Collect all needed dependencies. Instances (i) and factories (f) independent.
  2) Resolve each dependency independently starting from current container and moving to parent if not resolved in current.
  3) Run factories (f) to get missing instances
  4) Instantiate requested service using ready to use instances (i).
```
| containers | dep1  | dep2  | dep3  | dep4
|------------+-------+-------+-------+----
| root       |       |   f   |       |
| child1     |   i   |   .   |   f   |
| child2     |   .   |   .   |   .   |   i
```

- TODO: add external dynamic services config.
  It can be implemented by adding new arguments resolvers
  .yml or .json like this:
  @example
  ```json
  {
    "winstonLogger": ["devLoggerTransports"] // use dev transports for winstonLogger
    "logger": "winstonLogger", // use winston as default logger
    "notificationService": "slackNotificationService" // use slack service as notificationService
  }
  ```

- TODO: Add decorators services registering strategy
