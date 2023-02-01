# injecute
Lightweight extendable typesafe dependency injection container

### Key features
- typesafe
- explicit dependencies by default
- extensibility
- browser / node environments support

## Motivation
Most existing DI containers heavily rely on decorators and use them as main approach to manage dependencies.
But it leads us to breaking the IOC principle and our business code become dependent on concrete library that provides container and decorators.
We can handle it by creating "proxies" but it leads us to unnecessary boilerplate code.

Solution is not use the decorators as default way to register services.

## How to use

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

### Extensions

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
