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
  email: z.string().min(1, '请输入账户名'),
  password: z.string().min(8, '密码至少 8 位')
});

type FormValues = z.infer<typeof schema>;

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { loginManagement } = useAuth();
  const { locale } = useUiPreferences();
  const copy = getWebCopy(locale);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '',
      password: ''
    }
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await loginManagement(values);
      navigate('/admin');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'admin_login_failed');
    }
  });

  return (
    <WebAuthShell
      realm="management"
      title={copy.managementSignInTitle}
      description={copy.managementSignInDescription}
      footer={(
        <InfoBlock
          variant="info"
          title={copy.managementSurface}
          description={copy.managementSignInDescription}
          action={(
            <Link className="auth-footer-link" to="/admin/register">
              {copy.noAdminYet}
            </Link>
          )}
        />
      )}
    >
      <Form {...form}>
        <form className="auth-form-stack" onSubmit={submit}>
          <FormField control={form.control} name="email" render={({ field }) => (
            <FormItem className="auth-form-field">
              <FormLabel>{copy.emailLabel}</FormLabel>
              <FormControl><Input placeholder={copy.adminEmailPlaceholder} type="text" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="password" render={({ field }) => (
            <FormItem className="auth-form-field">
              <FormLabel>{copy.passwordLabel}</FormLabel>
              <FormControl><Input placeholder={copy.passwordPlaceholder} type="password" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          {error ? <InfoBlock variant="error" title={copy.managementEntry} description={error} /> : null}
          <Button disabled={form.formState.isSubmitting} type="submit" size="lg" className="w-full">
            {form.formState.isSubmitting ? copy.signingIn : copy.managementEntry}
          </Button>
        </form>
      </Form>
    </WebAuthShell>
  );
}
