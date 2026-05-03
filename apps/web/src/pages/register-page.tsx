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

export function RegisterPage() {
  const navigate = useNavigate();
  const { registerNormal } = useAuth();
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
    <main className="auth-shell">
      <Card className="auth-card">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Use `/register` to create the first owner account for this Tether workspace.</CardDescription>
        </CardHeader>
        <CardContent className="auth-card-content">
          <Form {...form}>
            <form className="auth-form-stack" onSubmit={submit}>
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem className="auth-form-field">
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input placeholder="Dream" {...field} />
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
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="name@example.com" type="text" {...field} />
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
                {form.formState.isSubmitting ? 'Creating account...' : 'Create your account'}
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter>
          <p className="auth-footer-copy">
            <Link className="auth-footer-link" to="/login">
              Already have an account? Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
