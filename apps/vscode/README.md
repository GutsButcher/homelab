# VS Code Server

Web-based Visual Studio Code instance for remote development directly from your browser.

## Overview

VS Code Server (code-server) provides:
- Full VS Code experience in browser
- Remote development environment
- Extension support
- Terminal access
- Git integration
- Multi-language support

**Official Documentation**: https://github.com/coder/code-server

## Status

⚠️ **Note**: This application is defined but not deployed (not included in apps/kustomization.yaml).

## Features

### Development Environment
- Full-featured code editor
- Integrated terminal
- Debugging support
- IntelliSense
- Syntax highlighting
- Code formatting

### Extensions
- Marketplace access
- Custom extension support
- Settings sync
- Theme support

### Collaboration
- Shareable workspace
- Live collaboration potential
- Remote pair programming
- Consistent environment

## Use Cases

1. **Remote Development**
   - Code from any device
   - Consistent environment
   - No local setup

2. **Quick Edits**
   - Configuration files
   - Documentation updates
   - Script modifications

3. **Learning**
   - Sandboxed environment
   - Pre-configured tools
   - Safe experimentation

## Configuration

Typical setup includes:
- Authentication method
- Extension allowlist
- Resource limits
- Workspace persistence
- Git configuration

## Security Considerations

- Strong authentication required
- HTTPS only
- Network isolation
- Resource limits
- Activity logging

## Deployment

To enable VS Code Server:
1. Add to `/apps/kustomization.yaml`
2. Configure authentication
3. Set resource limits
4. Mount workspace volume
5. Configure extensions

## Alternative Solutions

- JupyterLab
- Eclipse Che
- Gitpod
- Local VS Code with SSH

## Related Links

- [code-server Docs](https://coder.com/docs/code-server/latest)
- [Installation Guide](https://coder.com/docs/code-server/latest/install)
- [Configuration](https://coder.com/docs/code-server/latest/guide)
- [FAQ](https://coder.com/docs/code-server/latest/FAQ)