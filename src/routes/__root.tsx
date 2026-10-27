import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { initPwa } from "@/lib/pwa";
import appCss from "../styles.css?url";

function PwaInit() {
  useEffect(() => {
    initPwa();
  }, []);
  return null;
}

const APP_NAME = "Ribbon";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "description", content: "A private ledger for gifts your household gives and receives." },
      // Matches --color-page in each scheme. The inline script below keeps it right when the theme is picked by hand.
      { name: "theme-color", content: "#f5f5f7", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#030712", media: "(prefers-color-scheme: dark)" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-180.png" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)'),t=localStorage.getItem('ribbon-theme');if(t!=='dark'&&t!=='light'){t=m.matches?'dark':'light'}var c=function(x){var k=document.getElementById('theme-color-live');if(!k){k=document.createElement('meta');k.id='theme-color-live';k.name='theme-color';document.head.insertBefore(k,document.head.firstChild)}k.content=x==='dark'?'#030712':'#f5f5f7'};d.dataset.theme=t;c(t);m.addEventListener('change',function(e){if(!localStorage.getItem('ribbon-theme')){var n=e.matches?'dark':'light';d.dataset.theme=n;c(n)}})}catch(e){}",
          }}
        />
      </head>
      <body>
        <PwaInit />
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
