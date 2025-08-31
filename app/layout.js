import { Geist, Geist_Mono } from "next/font/google";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Ideiuda",
  description: "AI-powered ideation tool",
  icons: [
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '32x32',
      url: '/logo_ideiuda_sm.png',
    },
    {
      rel: 'icon',
      type: 'image/png',
      sizes: '16x16',
      url: '/logo_ideiuda_sm.png',
    },
    {
      rel: 'apple-touch-icon',
      sizes: '180x180',
      url: '/logo_ideiuda_sm.png',
    },
  ],
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          {/* Floating Auth Button */}
          <div className="fixed top-6 right-6 z-50 flex gap-2">
            <SignedOut >
              <SignInButton className="px-4 py-2 bg-transparent text-white  rounded-lg shadow-lg hover:bg-gradient-to-r from-violet-600/20 to-purple-400/20 text-white transition-colors" />
              <SignUpButton className="px-4 py-2 bg-gradient-to-r from-violet-600 to-purple-400 text-white rounded-lg shadow-lg hover:bg-green-600 transition-colors" />
            </SignedOut>
            <SignedIn>
              <div className="hidden sm:block">
                <UserButton 
                  afterSignOutUrl="/ideation"
                />
              </div>
            </SignedIn>
          </div>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
