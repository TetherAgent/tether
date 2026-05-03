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

export function AdminRegisterPage() {
  const navigate = useNavigate();
  const { registerManagement } = useAuth();
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
      await registerManagement(values);
      navigate('/admin');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'admin_register_failed');
    }
  });

  return (
    <WebAuthShell
      realm="management"
      title={copy.managementRegisterTitle}
      description={copy.managementRegisterDescription}
      footer={(
        <InfoBlock
          variant="info"
          title={copy.managementSurface}
          description={copy.managementRegisterDescription}
          action={(
            <Link className="auth-footer-link" to="/admin/login">
              {copy.adminReady}
            </Link>
          )}
        />
      )}
    >
      <Form {...form}>
        <form className="auth-form-stack" onSubmit={submit}>
          <FormField control={form.control} name="displayName" render={({ field }) => (
            <FormItem className="auth-form-field">
              <FormLabel>{copy.displayNameLabel}</FormLabel>
              <FormControl><Input placeholder={copy.operatorPlaceholder} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
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
          {error ? <InfoBlock variant="error" title={copy.setupManagement} description={error} /> : null}
          <Button disabled={form.formState.isSubmitting} type="submit" size="lg" className="w-full">
            {form.formState.isSubmitting ? copy.settingUpManagement : copy.setupManagement}
          </Button>
        </form>
      </Form>
    </WebAuthShell>
  );
}
