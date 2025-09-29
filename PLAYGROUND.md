# Injecute Playground

A sophisticated interactive playground for visualizing dependency injection containers and their service dependency trees in real-time.

## 🎯 How It Works

### Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Monaco Editor │ -> │ TypeScript       │ -> │ Tree Renderer   │
│                 │    │ Compiler         │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         ^                       │                       │
         │                       v                       v
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ User Types Code │    │ JavaScript       │    │ Visual Tree     │
│ (debounce)      │    │ Evaluation       │    │ Display         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Rendering Pipeline

1. **Code Input**: User types TypeScript code in Monaco Editor
2. **Debouncing**: 1000ms delay prevents excessive re-rendering while typing
3. **Compilation**: TypeScript code is compiled to JavaScript using typescript
4. **Evaluation**: Compiled code is evaluated to extract the DIContainer variable `container`
5. **Graph Building**: Uses the `buildServicesGraph` utility from injecute library
6. **Tree Rendering**: Custom `renderServicesTree` function creates HTML visualization
