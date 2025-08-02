# IT-Tools

IT-Tools is a collection of handy utilities for developers and IT professionals, providing various text, encoding, and data manipulation tools in a single web interface.

## Overview

IT-Tools provides:
- Text manipulation utilities
- Encoding/decoding tools
- Hash generators
- Data converters
- Network utilities
- Development helpers

**Official Repository**: https://github.com/CorentinTh/it-tools

## Access

- **URL**: https://it-tools.gwynbliedd.com
- **Authentication**: None required
- **Privacy**: All processing done client-side

## Tool Categories

### Crypto
- Hash generators (MD5, SHA, etc.)
- HMAC generator
- Bcrypt generator/checker
- UUID generator
- Password generator

### Converter
- Base64 encode/decode
- URL encode/decode
- HTML entities
- JSON formatter
- YAML/JSON converter
- Timestamp converter

### Web
- JWT decoder
- HTTP status codes
- URL parser
- User agent parser
- MIME types

### Text
- Case converter
- Text statistics
- Lorem ipsum generator
- String manipulation
- Diff checker

### Images
- Base64 image converter
- Image metadata viewer
- QR code generator
- Color picker

### Development
- Cron expression parser
- Regex tester
- JSON validator
- SQL formatter
- Docker run to compose

### Network
- IPv4/IPv6 tools
- Subnet calculator
- MAC address lookup
- Port checker

## Features

### Privacy First
- No server-side processing
- No data storage
- No tracking
- Works offline once loaded

### User Interface
- Clean, modern design
- Dark/light theme
- Responsive layout
- Quick search
- Favorites system

### Functionality
- Copy to clipboard
- Download results
- Share via URL
- Import files
- Batch processing

## Common Use Cases

### Development
1. Decode JWT tokens
2. Format JSON responses
3. Generate test data
4. Convert between formats
5. Test regular expressions

### Security
1. Generate secure passwords
2. Create hash values
3. Encode sensitive data
4. Check bcrypt hashes

### Troubleshooting
1. Decode base64 errors
2. Parse URLs
3. Check timestamps
4. Validate JSON
5. Compare text differences

## Favorite Tools Setup

1. Click star icon on frequently used tools
2. Access favorites from sidebar
3. Organize workflow
4. Quick access to common tasks

## Keyboard Shortcuts

- `Ctrl/Cmd + K` - Quick search
- `Ctrl/Cmd + Enter` - Process/Convert
- `Escape` - Clear input
- `Tab` - Navigate fields

## Integration Tips

### With Development Workflow
1. Bookmark specific tools
2. Use for API testing
3. Quick data validation
4. Format before commits

### With Other Services
1. Generate passwords for services
2. Create API tokens
3. Encode credentials
4. Validate configurations

## Troubleshooting

```bash
# Check IT-Tools pod
kubectl get pods -n it-tools

# View logs
kubectl logs -n it-tools -l app.kubernetes.io/name=it-tools

# Restart IT-Tools
kubectl rollout restart deployment it-tools -n it-tools

# Check service endpoint
kubectl get svc -n it-tools
```

## Deployment Notes

IT-Tools is:
- Stateless application
- No database required
- Minimal resource usage
- Client-side processing
- CDN-friendly

## Best Practices

### Usage
1. Bookmark frequently used tools
2. Use keyboard shortcuts
3. Save complex regex patterns
4. Export important results

### Security
1. Don't paste sensitive production data
2. Use for development/testing
3. Verify outputs independently
4. Clear browser data after sensitive operations

## Tool Highlights

### Most Useful Tools
1. **JWT Decoder**: Debug authentication
2. **JSON Formatter**: Clean API responses
3. **Base64**: Encode/decode data
4. **Hash Generator**: Create checksums
5. **Timestamp Converter**: Debug time issues
6. **Regex Tester**: Validate patterns
7. **Password Generator**: Secure passwords
8. **Diff Checker**: Compare configs

## Updates

IT-Tools is actively maintained:
- Regular tool additions
- UI improvements
- Bug fixes
- Community contributions

## Similar Tools

Complements IT-Tools:
- CyberChef (more advanced)
- DevToys (desktop app)
- Hoppscotch (API testing)
- JSONLint (validation focus)

## Related Links

- [GitHub Repository](https://github.com/CorentinTh/it-tools)
- [Tool List](https://it-tools.tech/)
- [Self-hosting Guide](https://github.com/CorentinTh/it-tools#self-host)
- [Contributing](https://github.com/CorentinTh/it-tools/blob/main/CONTRIBUTING.md)