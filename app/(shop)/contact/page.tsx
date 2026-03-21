import type { Metadata } from "next"
import { Mail, Phone, MapPin, Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { ContactForm } from "@/components/contact/contact-form"

export const metadata: Metadata = {
  title: "Контакти - Ovva Sculpt",
  description: "Свържете се с нас за въпроси относно нашите продукти или поръчки.",
}

export default function ContactPage() {
  return (
    <div className="bg-background py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Свържете се с нас
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Имате въпрос или искате да научите повече? Ще се радваме да чуем от вас!
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {/* Contact Info */}
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-foreground">Информация за контакт</h2>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Имейл</h3>
                    <a href="mailto:info@ovvasculpt.com" className="text-sm text-muted-foreground hover:text-primary">
                      info@ovvasculpt.com
                    </a>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Phone className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Телефон</h3>
                    <a href="tel:+359888123456" className="text-sm text-muted-foreground hover:text-primary">
                      +359 888 123 456
                    </a>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Адрес</h3>
                    <p className="text-sm text-muted-foreground">
                      София, България
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">Работно време</h3>
                    <p className="text-sm text-muted-foreground">
                      Пон-Пет: 9:00 - 18:00
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="rounded-lg bg-secondary p-6">
              <h3 className="font-semibold text-foreground">Често задавани въпроси</h3>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li>
                  <strong className="text-foreground">Колко време отнема доставката?</strong>
                  <p className="mt-1">Доставката със Speedy е до 2 работни дни в цяла България.</p>
                </li>
                <li>
                  <strong className="text-foreground">Мога ли да върна продукт?</strong>
                  <p className="mt-1">Да, в рамките на 14 дни от получаването, при непокътната опаковка.</p>
                </li>
                <li>
                  <strong className="text-foreground">Има ли безплатна доставка?</strong>
                  <p className="mt-1">Да, при поръчки над 30 € доставката до офис на куриер е безплатна.</p>
                </li>
              </ul>
            </div>
          </div>

          {/* Contact Form */}
          <div>
            <Card>
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold text-foreground">Изпратете съобщение</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Попълнете формата и ще ви отговорим възможно най-скоро.
                </p>
                <ContactForm />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
