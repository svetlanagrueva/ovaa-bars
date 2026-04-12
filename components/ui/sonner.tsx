'use client'

import { Toaster as Sonner, ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border/60 group-[.toaster]:shadow-lg group-[.toaster]:shadow-accent/[0.05] group-[.toaster]:rounded-[16px] group-[.toaster]:font-sans',
          title: 'group-[.toast]:text-sm group-[.toast]:font-medium group-[.toast]:tracking-[0.01em]',
          description: 'group-[.toast]:text-muted-foreground group-[.toast]:text-xs group-[.toast]:tracking-[0.01em]',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-full group-[.toast]:text-[10px] group-[.toast]:uppercase group-[.toast]:tracking-[0.12em] group-[.toast]:font-medium group-[.toast]:px-4 group-[.toast]:py-1.5',
          cancelButton:
            'group-[.toast]:bg-secondary group-[.toast]:text-muted-foreground group-[.toast]:rounded-full group-[.toast]:text-[10px] group-[.toast]:uppercase group-[.toast]:tracking-[0.12em]',
          closeButton:
            'group-[.toast]:text-muted-foreground group-[.toast]:border-border/60 group-[.toast]:bg-card group-[.toast]:hover:bg-secondary',
          icon: 'group-[.toast]:text-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
