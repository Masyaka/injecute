export const defaultCode = `import { DIContainer, type ServiceRegistry } from 'injecute';

interface Transport {
  send(to: string, text: string): void;
}

class EmailTransport implements Transport {
  send(to: string, text: string) {
    console.log(\`email to \${to}: \${text}\`);
  }
}

class Database {
  constructor(readonly url: string) {}
}

class PostRepository {
  constructor(readonly db: Database) {}
}

class PostService {
  constructor(
    private readonly posts: PostRepository,
    private readonly transport: Transport,
  ) {}
  publish(title: string) {
    this.transport.send('readers@example.com', \`New post: \${title}\`);
  }
}

// A module declares only what it needs.
const addBlog = (c: ServiceRegistry<{ db: Database; transport: Transport }>) =>
  c
    .addSingleton('posts', PostRepository, ['db'])
    .addSingleton('service', PostService, ['posts', 'transport']);

const container = new DIContainer()
  .addInstance('dbUrl', 'postgres://localhost/blog')
  .addSingleton('db', Database, ['dbUrl'])
  .addSingleton('emailTransport', EmailTransport)
  .addAlias('transport', 'emailTransport')
  .namespace('Blog', addBlog);

container.get('Blog.service').publish('Hello, injecute');

export default container;
`;
