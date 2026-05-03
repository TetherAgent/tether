import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input } from '@tether/design';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { useAuth } from '../hooks/use-auth.js';

const schema = z.object({
  displayName: z.string().trim().min(2, '请输入至少 2 个字符的名称'),
  email: z.string().min(1, '请输入账户名'),
  password: z.string().min(8, '密码至少 8 位')
});

type FormValues = z.infer<typeof schema>;

export function AdminRegisterPage() {
  const navigate = useNavigate();
  const { registerManagement } = useAuth();
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
    <main className="auth-shell">
      <Card className="auth-card">
        <CardHeader>
          <CardTitle>Set up management console</CardTitle>
          <CardDescription>Management auth stays isolated from terminal control and uses its own browser storage key.</CardDescription>
        </CardHeader>
        <CardContent className="auth-card-content">
          <Form {...form}>
            <form className="auth-form-stack" onSubmit={submit}>
              <FormField control={form.control} name="displayName" render={({ field }) => (
                <FormItem className="auth-form-field">
                  <FormLabel>Display name</FormLabel>
                  <FormControl><Input placeholder="Operator" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem className="auth-form-field">
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input placeholder="admin@example.com" type="text" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem className="auth-form-field">
                  <FormLabel>Password</FormLabel>
                  <FormControl><Input placeholder="Minimum 8 characters" type="password" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {error ? <p className="auth-error">{error}</p> : null}
              <Button disabled={form.formState.isSubmitting} type="submit">
                {form.formState.isSubmitting ? 'Setting up...' : 'Set up management console'}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter>
          <p className="auth-footer-copy">
            <Link className="auth-footer-link" to="/admin/login">
              Already set up? Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
