import { Bricolage_Grotesque, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import "./product.css";
import "./landing.css";
import { THEME_INIT } from "@/components/theme";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", weight: ["600", "700", "800"], display: "swap" });
const body = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata = {
  title: "Stale: know which facts have gone stale",
  description:
    "Stale reads your company data, remembers every fact with its source, and flags everything built on a fact the moment it changes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
