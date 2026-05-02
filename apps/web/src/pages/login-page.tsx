import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '../components/ui/card.js';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../components/ui/form.js';
import { Input } from '../components/ui/input.js';
import { useAuth } from '../hooks/use-auth.js';

const schema = z.object({
  email: z.email('请输入有效邮箱地址'),
  password: z.string().min(8, '密码至少 8 位')
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { loginNormal } = useAuth();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: 'phase5-owner-1777737471729@example.com',
      password: 'pw-123456'
    }
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await loginNormal(values);
      navigate('/');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'login_failed');
    }
  });

  return (
    <main className="auth-shell">
      <Card className="auth-card">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Normal user auth unlocks the existing terminal session shell and validates through `api/auth/me`.</CardDescription>
        </CardHeader>
        <CardContent className="auth-card-content">
          <Form {...form}>
            <form className="auth-form-stack" onSubmit={submit}>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="auth-form-field">
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="name@example.com" type="email" {...field} />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input placeholder="Minimum 8 characters" type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error ? <p className="auth-error">{error}</p> : null}
              <Button disabled={form.formState.isSubmitting} type="submit">
                {form.formState.isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter>
          <p className="auth-footer-copy">
            <Link className="auth-footer-link" to="/register">
              Don&apos;t have an account? Register
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
