import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button, InfoBlock, Input } from '@tether/design';
import { WebAuthShell } from '../components/console/web-auth-shell.js';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { useAuth } from '../hooks/use-auth.js';
import { useI18n } from '../hooks/use-i18n.js';

type FormValues = {
  email: string;
  password: string;
  confirmPassword: string;
};

export function RegisterPage() {
  const navigate = useNavigate();
  const { logoutNormal, registerNormal } = useAuth();
  const { t } = useI18n();
  const [error, setError] = React.useState<string | null>(null);
  const schema = React.useMemo(() => z.object({
    email: z.string().min(1, t.emailRequired),
    password: z.string().min(8, t.passwordMinLength),
    confirmPassword: z.string().min(8, t.passwordMinLength)
  }).refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: t.passwordConfirmMismatch
  }), [t.emailRequired, t.passwordConfirmMismatch, t.passwordMinLength]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: ''
    }
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await registerNormal({
        email: values.email,
        password: values.password
      });
      logoutNormal();
      navigate('/login', { replace: true });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t.registerFailed);
    }
  });

  return (
    <WebAuthShell
      title={t.normalRegisterTitle}
      description={t.normalRegisterDescription}
      footer={(
        <div className="auth-footer-panel">
          <div className="auth-footer-text">
            <div className="auth-footer-title">{t.authSurface}</div>
            <p>{t.sessionShellDescription}</p>
          </div>
          <Link className="auth-footer-link" to="/login">
            {t.alreadyHaveAccount}
          </Link>
        </div>
      )}
    >
      <Form {...form}>
        <form className="auth-form-stack" onSubmit={submit}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="auth-form-field">
                <FormLabel>{t.emailLabel}</FormLabel>
                <FormControl>
                  <Input placeholder={t.emailPlaceholder} type="text" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="auth-form-field">
                <FormLabel>{t.passwordLabel}</FormLabel>
                <FormControl>
                  <Input placeholder={t.passwordPlaceholder} type="password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="auth-form-field">
                <FormLabel>{t.passwordConfirmLabel}</FormLabel>
                <FormControl>
                  <Input placeholder={t.passwordConfirmPlaceholder} type="password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error ? <InfoBlock variant="error" title={t.createAccount} description={error} /> : null}
          <Button disabled={form.formState.isSubmitting} type="submit" size="lg" className="w-full">
            {form.formState.isSubmitting ? t.creatingAccount : t.createAccount}
          </Button>
        </form>
      </Form>
    </WebAuthShell>
  );
}
