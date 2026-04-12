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
      <section className="py-16 sm:py-20 lg:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              Контакти
            </p>
            <h1 className="mt-6 text-4xl font-light leading-[1.05] tracking-[-0.04em] text-foreground sm:text-5xl">
              Свържете се
              <span className="block text-muted-foreground">с нас</span>
            </h1>
            <p className="mt-6 max-w-xl mx-auto text-sm leading-relaxed text-muted-foreground">
              Имате въпрос или искате да научите повече? Ще се радваме да чуем от вас.
            </p>
          </div>
        </div>
      </section>

      {/* Contact Content */}
      <section className="pb-16 sm:pb-20 lg:pb-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Contact Info */}
            <div className="space-y-8">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  Информация за контакт
                </p>
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <Mail className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Имейл</h3>
                  <a href="mailto:info@eggorigin.com" className="mt-1 block text-sm text-muted-foreground transition-colors hover:text-accent">
                    info@eggorigin.com
                  </a>
                </div>

                <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <Phone className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Телефон</h3>
                  <a href="tel:+359888123456" className="mt-1 block text-sm text-muted-foreground transition-colors hover:text-accent">
                    +359 888 123 456
                  </a>
                </div>

                <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <MapPin className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Адрес</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    София, България
                  </p>
                </div>

                <div className="group relative overflow-hidden rounded-[26px] border border-border/40 bg-card/80 p-6 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]">
                  <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                    <Clock className="h-4 w-4 text-foreground" />
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-foreground">Работно време</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Пон-Пет: 9:00 - 18:00
                  </p>
                </div>
              </div>

              {/* FAQ Section */}
              <div className="mt-8 rounded-[26px] border border-border/40 bg-card/80 p-8">
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  Често задавани въпроси
                </p>
                <div className="mt-6 space-y-6">
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Колко време отнема доставката?</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Доставката е до 3 работни дни в цяла България. Поръчките направени до 14:00 ч.
                      се изпращат в същия ден, когато това е възможно. Поръчките, направени след 14:00 ч.,
                      се изпращат на следващия ден.
                    </p>
                  </div>
                  <div className="h-px bg-border/60" />
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Мога ли да платя с карта?</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Да, приемаме плащания с дебитна и кредитна карта.
                    </p>
                  </div>
                  <div className="h-px bg-border/60" />
                  <div>
                    <h3 className="text-sm font-medium text-foreground">Има ли безплатна доставка?</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      Да, при поръчки над 30 EUR доставката до офис на куриер е безплатна.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <div className="rounded-[26px] border border-border/40 bg-card/80 p-8 md:p-10">
                <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
                  Изпратете съобщение
                </p>
                <h2 className="mt-4 text-2xl font-light tracking-[-0.02em] text-foreground">
                  Пишете ни
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
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
