# React Deployment Guide

Deploy React applications and configure multi-site routing on DreamHost.

## Quick Start: Deploy a React App

### 1. Build Locally

Navigate to your React project and build:

```bash
npm run build
# or with Vite
npm run build  # creates ./dist
# or with Next.js
npm run build  # then npm run export
```

### 2. Deploy to DreamHost

```bash
python react_deployer.py deploy . /home/user/yourdomain.com
```

This will:
- Auto-detect your React framework (CRA, Vite, Next.js)
- Build your app (if not already built)
- Upload build artifacts to DreamHost
- Clean up old deployment

Your app is now live at `yourdomain.com`!

### 3. Configure Client-Side Routing

If your app uses React Router, configure routing:

```bash
python routing_manager.py configure-app /home/user/yourdomain.com
```

This creates a `.htaccess` file that:
- Routes all requests to `index.html`
- Enables gzip compression
- Sets cache headers

Done! React Router will now handle all routing.

## Supported Frameworks

### Create React App (CRA)

```bash
npx create-react-app my-app
cd my-app
npm run build
python react_deployer.py deploy . /home/user/yourdomain.com
```

- Build command: `npm run build`
- Output directory: `./build`
- Build time: 2-3 minutes

### Vite

```bash
npm create vite@latest my-app -- --template react
cd my-app
npm install
npm run build
python react_deployer.py deploy . /home/user/yourdomain.com
```

- Build command: `npm run build`
- Output directory: `./dist`
- Build time: 20-30 seconds (much faster!)

### Next.js (Static Export)

For static export (no server required):

```bash
npx create-next-app@latest
cd my-app
npm run build
python react_deployer.py deploy . /home/user/yourdomain.com
```

**Important**: Configure Next.js for static export in `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // ... other config
}
module.exports = nextConfig
```

- Build command: `npm run build`
- Output directory: `./out`

## Advanced Deployments

### Custom Build Command

Use a custom build command:

```bash
python react_deployer.py deploy . /home/user/yourdomain.com --build-command "yarn build"
```

### Skip Build (Use Existing Build)

If you already built locally:

```bash
python react_deployer.py deploy . /home/user/yourdomain.com --skip-build
```

### Environment Variables

For production builds with environment variables:

1. Create `.env.production`:
   ```
   REACT_APP_API_URL=https://yourdomain.com/api
   REACT_APP_ENV=production
   ```

2. Build with environment:
   ```bash
   npm run build
   ```

3. Deploy:
   ```bash
   python react_deployer.py deploy . /home/user/yourdomain.com --skip-build
   ```

## Multi-Site Setup

Host multiple React apps on the same domain using subdomains or subdirectories.

### Subdomain Setup (App per Subdomain)

Example: `app1.yourdomain.com` and `app2.yourdomain.com`

#### Step 1: Create Subdomains in DreamHost Panel

1. Go to **Domains** → **Manage Domains**
2. Add subdomains:
   - `app1.yourdomain.com` → `/home/user/app1.yourdomain.com`
   - `app2.yourdomain.com` → `/home/user/app2.yourdomain.com`
3. Wait for DNS to propagate

#### Step 2: Deploy Apps

App 1:
```bash
python react_deployer.py deploy ./app1 /home/user/app1.yourdomain.com
python routing_manager.py configure-subdomain /home/user/app1.yourdomain.com
```

App 2:
```bash
python react_deployer.py deploy ./app2 /home/user/app2.yourdomain.com
python routing_manager.py configure-subdomain /home/user/app2.yourdomain.com
```

Access apps at:
- `https://app1.yourdomain.com`
- `https://app2.yourdomain.com`

### Subdirectory Setup (Multiple Apps per Domain)

Example: `yourdomain.com/app1` and `yourdomain.com/app2`

#### Step 1: Create Subdirectories

```bash
python sftp_operations.py mkdir /home/user/yourdomain.com/app1
python sftp_operations.py mkdir /home/user/yourdomain.com/app2
```

#### Step 2: Deploy Apps

App 1:
```bash
python react_deployer.py deploy ./app1 /home/user/yourdomain.com/app1
python routing_manager.py configure-subdir app1 /home/user/yourdomain.com/app1
```

App 2:
```bash
python react_deployer.py deploy ./app2 /home/user/yourdomain.com/app2
python routing_manager.py configure-subdir app2 /home/user/yourdomain.com/app2
```

#### Step 3: Configure React Router Base Path

For subdirectory deployment, update React Router:

```javascript
import { BrowserRouter } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter basename="/app1">
      {/* Routes */}
    </BrowserRouter>
  );
}
```

Access apps at:
- `https://yourdomain.com/app1`
- `https://yourdomain.com/app2`

## Routing Configuration Details

The routing manager creates `.htaccess` files with:

```apache
# Enable mod_rewrite
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # Don't rewrite files or directories
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d

  # Rewrite everything else to index.html
  RewriteRule ^(.*)$ index.html [QSA,L]
</IfModule>
```

This ensures:
- Static files are served directly
- Directories are accessed normally
- All other requests go to `index.html` for React Router

## Troubleshooting

### "Cannot GET /path" After Deployment

**Problem**: Routes return 404 instead of loading app

**Solution**: Configure routing:
```bash
python routing_manager.py configure-app /home/user/yourdomain.com
```

### Build Artifacts Not Found

**Problem**: `build`, `dist`, or `out` directory doesn't exist

**Solution**:
1. Build locally first:
   ```bash
   npm run build
   ```
2. Then deploy with skip-build:
   ```bash
   python react_deployer.py deploy . /home/user/yourdomain.com --skip-build
   ```

### App Shows Old Version

**Problem**: Changes not reflected after deployment

**Solution**:
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+Shift+R)
3. Check file uploaded:
   ```bash
   python sftp_operations.py list /home/user/yourdomain.com
   ```

### Subdirectory Routes Don't Work

**Problem**: `/app1/page` shows 404

**Solution**:
1. Update `basename` in React Router:
   ```javascript
   <BrowserRouter basename="/app1">
   ```
2. Configure routing:
   ```bash
   python routing_manager.py configure-subdir app1 /home/user/yourdomain.com/app1
   ```

### Environment Variables Not Working

**Problem**: `process.env.REACT_APP_*` is undefined

**Solution**:
1. Build locally with variables:
   ```bash
   REACT_APP_API_URL=https://yourdomain.com npm run build
   ```
2. Deploy without rebuilding:
   ```bash
   python react_deployer.py deploy . /home/user/yourdomain.com --skip-build
   ```

## Performance Tips

1. **Use Vite** - Much faster builds (20-30s vs 2-3m)
2. **Code splitting** - Split routes for faster load:
   ```javascript
   const Page = lazy(() => import('./pages/Page'));
   ```
3. **Compression** - Routing manager enables gzip automatically
4. **Cache headers** - Browser caches JS/CSS for 1 month
5. **Lazy load images** - Use native lazy loading:
   ```jsx
   <img loading="lazy" src="..." />
   ```

## Next Steps

- See `setup_guide.md` for initial setup
- See `common_workflows.md` for general file operations
- Check DreamHost docs for domain/subdomain configuration
