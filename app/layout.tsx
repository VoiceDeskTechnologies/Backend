import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HandsFree | Let AI handle the call",
  description: "Your AI, on the phone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
