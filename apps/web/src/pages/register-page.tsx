import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button, InfoBlock, Input } from '@tether/design';
import { WebAuthShell } from '../components/console/WebAuthShell.js';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { useUiPreferences } from '../hooks/use-ui-preferences.js';
import { useAuth } from '../hooks/use-auth.js';
import { getWebCopy } from '../lib/ui-copy.js';

const schema = z.object({
  displayName: z.string().trim().min(2, '请输入至少 2 个字符的名称'),
  email: z.string().min(1, '请输入账户名'),
  password: z.string().min(8, '密码至少 8 位')
});

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { registerNormal } = useAuth();
  const { locale } = useUiPreferences();
  const copy = getWebCopy(locale);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: '',
      email: '',
      password: ''
    }
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await registerNormal(values);
      navigate('/');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'register_failed');
    }
  });

  return (
    <WebAuthShell
      realm="normal"
      title={copy.normalRegisterTitle}
      description={copy.normalRegisterDescription}
      footer={(
        <InfoBlock
          variant="info"
          title={copy.authSurface}
          description={copy.sessionShellDescription}
          action={(
            <Link className="auth-footer-link" to="/login">
              {copy.alreadyHaveAccount}
            </Link>
          )}
        />
      )}
    >
      <Form {...form}>
        <form className="auth-form-stack" onSubmit={submit}>
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem className="auth-form-field">
                <FormLabel>{copy.displayNameLabel}</FormLabel>
                <FormControl>
                  <Input placeholder={copy.displayNamePlaceholder} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="auth-form-field">
                <FormLabel>{copy.emailLabel}</FormLabel>
                <FormControl>
                  <Input placeholder={copy.emailPlaceholder} type="text" {...field} />
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
                <FormLabel>{copy.passwordLabel}</FormLabel>
                <FormControl>
                  <Input placeholder={copy.passwordPlaceholder} type="password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {error ? <InfoBlock variant="error" title={copy.createAccount} description={error} /> : null}
          <Button disabled={form.formState.isSubmitting} type="submit" size="lg" className="w-full">
            {form.formState.isSubmitting ? copy.creatingAccount : copy.createAccount}
          </Button>
        </form>
      </Form>
    </WebAuthShell>
  );
}
