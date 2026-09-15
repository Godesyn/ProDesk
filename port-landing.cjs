const fs = require('fs');
const path = require('path');

const adeyyHtmlPath = path.join(__dirname, 'adeyy/client/public/adeyy/Adeyy.html');
const outPath = path.join(__dirname, 'clients/links/src/app/LandingPage.tsx');
const outJsPath = path.join(__dirname, 'clients/links/public/adeyy/assets/marketing-script.js');

const htmlContent = fs.readFileSync(adeyyHtmlPath, 'utf8');

// Extract styles
const styleMatch = htmlContent.match(/<style>([\s\S]*?)<\/style>/);
const styles = styleMatch ? styleMatch[1] : '';

// Extract body
const bodyMatch = htmlContent.match(/<body class="mkt adeyy">([\s\S]*?)<script src="https:\/\/unpkg.com\/qrcode-generator@1.4.4\/qrcode.js">/);
let body = bodyMatch ? bodyMatch[1] : '';

// Convert HTML to JSX
body = body.replace(/class=/g, 'className=');
body = body.replace(/<!--([\s\S]*?)-->/g, '{/* $1 */}');
body = body.replace(/style="([^"]*)"/g, (match, styleStr) => {
    const props = styleStr.split(';').filter(Boolean).map(s => {
        let [key, val] = s.split(':');
        if (!key || !val) return '';
        key = key.trim().replace(/-([a-z])/g, g => g[1].toUpperCase());
        val = val.trim();
        return `${key}: '${val}'`;
    }).filter(Boolean).join(', ');
    return `style={{ ${props} }}`;
});

body = body.replace(/<script[\s\S]*?<\/script>/g, '');
const voidElements = ['img', 'input', 'hr', 'br', 'meta', 'link'];
voidElements.forEach(tag => {
    const regex = new RegExp(`<${tag}([^>]*[^/])>`, 'g');
    body = body.replace(regex, `<${tag}$1 />`);
});

// Extract inline JS
const jsMatch = htmlContent.match(/<script>\s*\(\s*function\s*\(\)\s*\{([\s\S]*?)\}\)\(\);\s*<\/script>/);
let jsContent = jsMatch ? '(function() {' + jsMatch[1] + '})();' : '';

// Write JS to public file
fs.writeFileSync(outJsPath, jsContent);

const component = `import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

export function LandingPage() {
  const [, setLocation] = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Add marketing CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/adeyy/assets/marketing.css';
    document.head.appendChild(link);

    // Setup link interception
    const handleNav = (e: MouseEvent) => {
      const target = (e.target as Element).closest('a');
      if (target) {
        const href = target.getAttribute('href');
        if (href && href.startsWith('/')) {
          e.preventDefault();
          setLocation(href);
        }
      }
    };
    if (rootRef.current) {
        rootRef.current.addEventListener('click', handleNav);
    }

    // Load scripts sequentially
    const loadScript = (src: string) => {
      return new Promise<void>((resolve) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        // Give it an id to clean it up later if we want, but it's fine to leave them
        document.body.appendChild(script);
      });
    };

    let scriptElement: HTMLScriptElement | null = null;
    
    Promise.all([
      loadScript('https://unpkg.com/qrcode-generator@1.4.4/qrcode.js'),
    ]).then(() => {
      return loadScript('/adeyy/assets/qr.js');
    }).then(() => {
      // Finally load our extracted marketing script
      scriptElement = document.createElement('script');
      scriptElement.src = '/adeyy/assets/marketing-script.js';
      document.body.appendChild(scriptElement);
    });

    return () => {
      document.head.removeChild(link);
      if (rootRef.current) {
        rootRef.current.removeEventListener('click', handleNav);
      }
      if (scriptElement && scriptElement.parentNode) {
        scriptElement.parentNode.removeChild(scriptElement);
      }
      // Note: we can't easily clear the timers here because they are private to the IIFE.
      // But we can just reload the page if it becomes an issue, or we could expose a global clearSub.
      if (typeof window !== 'undefined' && (window as any).__adeyyClearSub) {
          (window as any).__adeyyClearSub();
      }
    };
  }, [setLocation]);

  // .adeyy-app is required for adeyy.css custom properties and button styles
  return (
    <div className="mkt adeyy adeyy-app" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: \`${styles.replace(/`/g, '\\`')}\` }} />
      ${body}
    </div>
  );
}
`;

fs.writeFileSync(outPath, component);
console.log('Successfully ported Adeyy.html to LandingPage.tsx with separate JS file');
