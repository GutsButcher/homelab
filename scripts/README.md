# Scripts Directory

This directory is reserved for utility scripts and automation tools to enhance homelab management.

## Overview

The scripts directory will contain:
- FluxCD management utilities
- Secret management tools
- Application deployment helpers
- Backup and restore scripts
- Monitoring and debugging tools
- GitOps workflow automation

## Current Status

The directory is currently empty but has comprehensive plans documented in `CLAUDE.md` for future implementation.

## Planned Script Categories

### 1. **Flux Management**
- Health checks and status monitoring
- Bulk suspend/resume operations
- Reconciliation management

### 2. **Secret Management**
- Sealed secret generation wrappers
- Secret rotation automation
- Backup utilities

### 3. **Application Management**
- New app scaffolding
- Resource usage reporting
- Deployment automation

### 4. **Backup & Restore**
- PVC backup automation
- Cluster state export
- Disaster recovery tools

### 5. **Development Helpers**
- Pre-commit validation
- Configuration comparison
- Testing utilities

### 6. **Monitoring & Debugging**
- Log collection
- Ingress testing
- Performance analysis

### 7. **GitOps Workflow**
- Environment promotion
- Rollback automation
- Change management

## Getting Started

To implement a new script:

1. Create script file in this directory
2. Make it executable: `chmod +x script-name.sh`
3. Follow the standards outlined in `CLAUDE.md`
4. Test thoroughly before use
5. Document usage and examples

## Best Practices

- Use error handling (`set -euo pipefail`)
- Include help text and usage examples
- Make scripts idempotent
- Add dry-run options
- Log operations with timestamps

## Future Plans

See `CLAUDE.md` for detailed implementation plans and script ideas.

## Contributing

When adding scripts:
1. Follow naming conventions
2. Include comprehensive comments
3. Add error handling
4. Document dependencies
5. Update this README

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) - Detailed script ideas and implementation plans
- [Main README](../README.md) - Repository overview
- [FluxCD Documentation](https://fluxcd.io/flux/) - For Flux-related scripts