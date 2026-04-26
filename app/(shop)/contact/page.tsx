import type { Metadata } from "next"
import { Mail, Phone, MapPin, Clock } from "lucide-react"
import { ContactForm } from "@/components/contact/contact-form"

export const metadata: Metadata = {
  title: "Контакти - Egg Origin",
  description: "Свържете се с нас за въпроси относно нашите продукти или поръчки.",
}

export default function ContactPage() {
  return (
    <div className="bg-background">
      {/* Hero Section */}
      <section className="py-12 sm:py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
              Контакти
            </p>
            <h1 className="mt-4 text-[32px] font-light leading-[1.1] tracking-[-0.03em] text-foreground sm:mt-6 sm:text-4xl sm:leading-[1.05] sm:tracking-[-0.04em] lg:text-5xl">
              Свържете се
              <span className="block text-muted-foreground">с нас</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[13px] leading-[1.7] text-muted-foreground sm:mt-6 sm:text-sm sm:leading-7">
              Имате въпрос или искате да научите повече? Ще се радваме да чуем от вас.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Content */}
      <section className="pb-12 sm:pb-16 lg:pb-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="grid gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Contact Info */}
            <div className="space-y-6 sm:space-y-8">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                  Информация за контакт
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-5 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-6">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <Mail className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Имейл</h3>
                  <a href="mailto:info@eggorigin.com" className="mt-1 block text-[13px] text-muted-foreground transition-colors hover:text-accent sm:text-sm">
                    info@eggorigin.com
                  </a>
                </div>

                <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-5 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-6">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <Phone className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Телефон</h3>
                  <a href="tel:+359888123456" className="mt-1 block text-[13px] text-muted-foreground transition-colors hover:text-accent sm:text-sm">
                    +359 888 123 456
                  </a>
                </div>

                <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-5 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-6">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <MapPin className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Адрес</h3>
                  <p className="mt-1 text-[13px] text-muted-foreground sm:text-sm">
                    София, България
                  </p>
                </div>

                <div className="group relative overflow-hidden rounded-[18px] border border-border/40 bg-card/80 p-5 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05] sm:rounded-[26px] sm:p-6">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <Clock className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Работно време</h3>
                  <p className="mt-1 text-[13px] text-muted-foreground sm:text-sm">
                    Пон-Пет: 9:00 - 18:00
                  </p>
                </div>
              </div>

              {/* FAQ Section */}
              <div className="mt-6 rounded-[18px] border border-border/40 bg-card/80 p-6 sm:mt-8 sm:rounded-[26px] sm:p-8">
                <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                  Често задавани въпроси
                </p>
                <div className="mt-5 space-y-5 sm:mt-6 sm:space-y-6">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Колко време отнема доставката?</h3>
                    <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm sm:leading-7">
                      Доставката е до 3 работни дни в цяла България. Поръчките направени до 14:00 ч.
                      се изпращат в същия ден, когато това е възможно. Поръчките, направени след 14:00 ч.,
                      се изпращат на следващия ден.
                    </p>
                  </div>
                  <div className="h-px bg-border/60" />
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Мога ли да платя с карта?</h3>
                    <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm sm:leading-7">
                      Да, приемаме плащания с дебитна и кредитна карта.
                    </p>
                  </div>
                  <div className="h-px bg-border/60" />
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Има ли безплатна доставка?</h3>
                    <p className="mt-2 text-[13px] leading-[1.6] text-muted-foreground sm:text-sm sm:leading-7">
                      Да, при поръчки над 30 EUR доставката до офис на куриер е безплатна.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <div className="rounded-[18px] border border-border/40 bg-card/80 p-6 sm:rounded-[26px] sm:p-8 md:p-10">
                <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground sm:text-[11px] sm:tracking-[0.3em]">
                  Изпратете съобщение
                </p>
                <h2 className="mt-3 text-[22px] font-light tracking-[-0.02em] text-foreground sm:mt-4 sm:text-2xl">
                  Пишете ни
                </h2>
                <p className="mt-2 text-[13px] text-muted-foreground sm:text-sm">
                  Попълнете формата и ще ви отговорим възможно най-скоро.
                </p>
                <ContactForm />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
