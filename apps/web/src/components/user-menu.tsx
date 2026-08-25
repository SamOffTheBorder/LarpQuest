'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import Link from 'next/link';
import { SettingsIcon, LogOutIcon, ChevronDownIcon, WalletIcon, UserIcon } from 'lucide-react';

import { signOutAction } from '@/lib/auth-actions';
import { cn } from '@/lib/utils';

export function UserMenu({ displayName }: { displayName: string }) {
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-sm text-foreground',
          'hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none',
        )}
      >
        <span className="max-w-40 truncate">{displayName}</span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner sideOffset={6} align="end">
          <MenuPrimitive.Popup className="min-w-44 rounded-xl bg-popover p-1 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <MenuPrimitive.Item
              render={<Link href="/settings/appearance" />}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              <SettingsIcon className="size-4" />
              Appearance
            </MenuPrimitive.Item>
            <MenuPrimitive.Item
              render={<Link href="/settings/spending" />}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              <WalletIcon className="size-4" />
              Spending
            </MenuPrimitive.Item>
            <MenuPrimitive.Item
              render={<Link href="/settings/account" />}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              <UserIcon className="size-4" />
              Account
            </MenuPrimitive.Item>
            <MenuPrimitive.Separator className="my-1 h-px bg-border" />
            <MenuPrimitive.Item
              render={
                <form action={signOutAction}>
                  <button type="submit" className="flex w-full items-center gap-2 text-left" />
                </form>
              }
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-destructive outline-none data-highlighted:bg-destructive/10"
            >
              <LogOutIcon className="size-4" />
              Sign out
            </MenuPrimitive.Item>
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
