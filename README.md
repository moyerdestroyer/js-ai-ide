# JavaScript AI IDE

A browser-based JavaScript IDE with AI-powered code completion courtesy of Transformer.js, built with React and Monaco Editor.

## Features

- **AI Code Completion**: Powered by Hugging Face Transformers (codegen-350M-mono) running in a Web Worker
- **Monaco Editor**: Full-featured code editor with syntax highlighting and IntelliSense
- **File Management**: Create, rename, and delete multiple JavaScript files
- **Customization**: Toggle between light/dark themes and adjust font family and size
- **Persistence**: Files are automatically saved to browser localStorage

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

## Tech Stack

- **React 19** - UI framework
- **Monaco Editor** - Code editor
- **Hugging Face Transformers** - AI model for code completion
- **Vite** - Build tool
- **Web Workers** - Background AI processing

## Live Demo

Visit the [live demo](https://moyerdestroyer.github.io/js-ai-ide) on GitHub Pages.

