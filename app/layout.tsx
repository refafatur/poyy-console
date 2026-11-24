import type { Metadata } from "next";
import { Barlow_Condensed, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const displayFont = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
});

const sansFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "POYY CONSOLE — Connected Motorsport Platform",
  description: "Pair your phone as a wireless tilt-steer controller and race on winding 3D circuits.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
